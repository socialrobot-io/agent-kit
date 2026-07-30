/**
 * Persistent curated memory: bounded, file-backed, survives across sessions.
 *
 * Port of `vendor/hermes/tools/memory_tool.py` (MIT).
 * Two stores:
 *  - MEMORY.md: agent's personal notes (environment facts, project
 *    conventions, tool quirks, things learned)
 *  - USER.md: what the agent knows about the user (preferences, communication
 *    style, expectations, workflow habits)
 *
 * Both are injected into the system prompt as a FROZEN SNAPSHOT at session
 * start. Mid-session writes update files on disk immediately (durable) but do
 * NOT change the system prompt, preserving the prefix cache for the session.
 * The snapshot refreshes on the next session start.
 *
 * Parallel chats that share one filesystem (one tenant volume) serialize
 * add/replace/remove/applyBatch via an exclusive queue keyed by that fs, so
 * reload→mutate→persist cannot lose updates across MemoryStore instances.
 *
 * Entry delimiter: § (section sign). Entries can be multiline.
 * Character limits (not tokens) because char counts are model-independent.
 */

import { exclusiveFor } from "./exclusive.js";
import { firstThreatMessage } from "./threats.js";
import { scrubSecrets } from "./scrub-secrets.js";

export const ENTRY_DELIMITER = "\n§\n";

/** Stable header prefixes for the system-prompt memory blocks. */
export const MEMORY_BLOCK_HEADERS: Record<MemoryTarget, string> = {
  memory: "MEMORY (your personal notes)",
  user: "USER PROFILE (who the user is)",
};

export type MemoryTarget = "memory" | "user";

export interface MemoryResult {
  success: boolean;
  done?: boolean;
  message?: string;
  error?: string;
  usage?: string;
  current_entries?: string[];
  matches?: string[];
  [key: string]: unknown;
}

interface MemoryOperation {
  action: "add" | "replace" | "remove";
  content?: string;
  old_text?: string;
}

/**
 * Minimal filesystem abstraction the store needs. The production
 * implementation is backed by a per-tenant AgentFS volume; tests can use a
 * plain in-memory map. All paths are POSIX-style relative to the agent home.
 */
export interface MemoryFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  rename?(from: string, to: string): Promise<void>;
}

export interface MemoryStoreOptions {
  memoryCharLimit?: number;
  userCharLimit?: number;
  /** Directory holding MEMORY.md / USER.md, relative to the fs root. */
  memoryDir?: string;
  /** Host secrets scrubbed before memory content is stored. */
  secrets?: string[];
}

const DEFAULT_MEMORY_LIMIT = 2200;
const DEFAULT_USER_LIMIT = 1375;
const DEFAULT_MEMORY_DIR = "memories";

/**
 * Dual-state memory store:
 *  - `_systemPromptSnapshot`: frozen at load, used for system-prompt injection.
 *    Never mutated mid-session (keeps prefix cache stable).
 *  - live entries: mutated by tool calls, persisted to disk.
 */
export class MemoryStore {
  private memoryEntries: string[] = [];
  private userEntries: string[] = [];
  private readonly memoryCharLimit: number;
  private readonly userCharLimit: number;
  private readonly memoryDir: string;
  private readonly secrets: string[];
  private systemPromptSnapshot: Record<MemoryTarget, string> = { memory: "", user: "" };
  private loaded = false;

  constructor(
    private readonly fs: MemoryFs,
    options: MemoryStoreOptions = {},
  ) {
    this.memoryCharLimit = options.memoryCharLimit ?? DEFAULT_MEMORY_LIMIT;
    this.userCharLimit = options.userCharLimit ?? DEFAULT_USER_LIMIT;
    this.memoryDir = options.memoryDir ?? DEFAULT_MEMORY_DIR;
    this.secrets = options.secrets ?? [];
  }

  private scrub(content: string): string {
    return scrubSecrets(content, this.secrets);
  }

  private pathFor(target: MemoryTarget): string {
    return `${this.memoryDir}/${target === "user" ? "USER.md" : "MEMORY.md"}`;
  }

  private charLimit(target: MemoryTarget): number {
    return target === "user" ? this.userCharLimit : this.memoryCharLimit;
  }

  private entriesFor(target: MemoryTarget): string[] {
    return target === "user" ? this.userEntries : this.memoryEntries;
  }

  private setEntries(target: MemoryTarget, entries: string[]): void {
    if (target === "user") this.userEntries = entries;
    else this.memoryEntries = entries;
  }

  private charCount(target: MemoryTarget): number {
    const entries = this.entriesFor(target);
    if (entries.length === 0) return 0;
    return entries.join(ENTRY_DELIMITER).length;
  }

  private parseEntries(raw: string): string[] {
    return raw
      .split(ENTRY_DELIMITER)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  }

  /**
   * Load entries from MEMORY.md and USER.md and capture the system-prompt
   * snapshot. Each entry is scanned for injection/promptware at snapshot-build
   * time: any hit replaces the entry text in the SNAPSHOT with a
   * `[BLOCKED: ...]` placeholder, so a poisoned-on-disk file cannot inject
   * into the system prompt. Live state keeps the raw text so the user can
   * inspect and remove poisoned entries.
   */
  async loadFromDisk(): Promise<void> {
    this.memoryEntries = await this.readEntries("memory");
    this.userEntries = await this.readEntries("user");
    // Dedupe preserving order.
    this.memoryEntries = [...new Set(this.memoryEntries)];
    this.userEntries = [...new Set(this.userEntries)];

    const sanitizedMemory = this.sanitizeForSnapshot(this.memoryEntries, "MEMORY.md");
    const sanitizedUser = this.sanitizeForSnapshot(this.userEntries, "USER.md");

    this.systemPromptSnapshot = {
      memory: this.renderBlock("memory", sanitizedMemory),
      user: this.renderBlock("user", sanitizedUser),
    };
    this.loaded = true;
  }

  /**
   * Re-read MEMORY.md / USER.md and rebuild the system-prompt snapshot.
   * Call at the start of each HTTP chat request when the runtime is a
   * long-lived process singleton (e.g. Next.js) so mid-session writes from
   * earlier requests appear in the next turn's system prompt.
   */
  async refreshSnapshot(): Promise<void> {
    await this.loadFromDisk();
  }

  /** Live list of entries for a target (does not change the frozen snapshot). */
  async list(target: MemoryTarget): Promise<MemoryResult> {
    await this.reloadTarget(target);
    const entries = this.getEntries(target);
    const current = this.charCount(target);
    const limit = this.charLimit(target);
    return {
      success: true,
      target,
      entries,
      usage: `${current}/${limit}`,
      message: entries.length
        ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in '${target}'.`
        : `No entries in '${target}' yet.`,
    };
  }

  private async readEntries(target: MemoryTarget): Promise<string[]> {
    const raw = await this.fs.readFile(this.pathFor(target));
    if (raw == null || raw.trim() === "") return [];
    return this.parseEntries(raw);
  }

  private sanitizeForSnapshot(entries: string[], filename: string): string[] {
    return entries.map((entry) => {
      const threat = firstThreatMessage(entry, "strict");
      if (threat) {
        const ids = threat.match(/'([^']+)'/)?.[1] ?? "unknown";
        return `[BLOCKED: ${filename} entry contained threat pattern: ${ids}. Removed from system prompt.]`;
      }
      return entry;
    });
  }

  private renderBlock(target: MemoryTarget, entries: string[]): string {
    if (entries.length === 0) return "";
    const limit = this.charLimit(target);
    const content = entries.join(ENTRY_DELIMITER);
    const current = content.length;
    const pct = limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
    const header = MEMORY_BLOCK_HEADERS[target];
    const rule = "═".repeat(46);
    return (
      `${rule}\n` +
      `${header} [${pct}% — ${current}/${limit} chars]\n` +
      `${rule}\n` +
      `${content}`
    );
  }

  /**
   * Return the frozen snapshot for system-prompt injection (the state captured
   * at loadFromDisk(), NOT live state). Returns null if empty at load time.
   */
  formatForSystemPrompt(target: MemoryTarget): string | null {
    const block = this.systemPromptSnapshot[target];
    return block ? block : null;
  }

  /** Combined snapshot for both stores, for the system prompt. */
  formatAllForSystemPrompt(): string {
    const parts = [this.systemPromptSnapshot.memory, this.systemPromptSnapshot.user].filter(Boolean);
    return parts.join("\n\n");
  }

  private async persist(target: MemoryTarget): Promise<void> {
    const entries = this.entriesFor(target);
    const content = entries.length === 0 ? "" : entries.join(ENTRY_DELIMITER) + "\n";
    await this.fs.writeFile(this.pathFor(target), content);
  }

  private successResponse(target: MemoryTarget, message: string): MemoryResult {
    const current = this.charCount(target);
    const limit = this.charLimit(target);
    return { success: true, done: true, message, usage: `${current}/${limit}` };
  }

  private consolidationFailure(target: MemoryTarget, result: MemoryResult): MemoryResult {
    const current = this.charCount(target);
    const limit = this.charLimit(target);
    return { ...result, usage: `${current}/${limit}` };
  }

  /**
   * Serialize reload→mutate→persist across every MemoryStore that shares this
   * filesystem. Per-call FS queues alone cannot make that RMW atomic when
   * parallel chats each hold their own store on one tenant volume.
   */
  private mutateExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return exclusiveFor(this.fs as object)(fn);
  }

  async add(target: MemoryTarget, content: string): Promise<MemoryResult> {
    content = this.scrub(content.trim());
    if (!content) return { success: false, error: "Content cannot be empty." };

    const scanError = firstThreatMessage(content, "strict");
    if (scanError) return { success: false, error: scanError };

    return this.mutateExclusive(() => this.addLocked(target, content));
  }

  private async addLocked(target: MemoryTarget, content: string): Promise<MemoryResult> {
    await this.reloadTarget(target);
    const entries = [...this.entriesFor(target)];
    const limit = this.charLimit(target);

    if (entries.includes(content)) {
      return this.successResponse(target, "Entry already exists (no duplicate added).");
    }

    const newTotal = [...entries, content].join(ENTRY_DELIMITER).length;
    if (newTotal > limit) {
      const current = this.charCount(target);
      return this.consolidationFailure(target, {
        success: false,
        error:
          `Memory at ${current}/${limit} chars. ` +
          `Adding this entry (${content.length} chars) would exceed the limit. ` +
          `Consolidate now: use 'replace' to merge overlapping entries into ` +
          `shorter ones or 'remove' stale or less important entries (see ` +
          `current_entries below), then retry this add — all in this turn.`,
        current_entries: entries,
        usage: `${current}/${limit}`,
      });
    }

    entries.push(content);
    this.setEntries(target, entries);
    await this.persist(target);
    return this.successResponse(target, "Entry added.");
  }

  async replace(target: MemoryTarget, oldText: string, newContent: string): Promise<MemoryResult> {
    oldText = oldText.trim();
    newContent = this.scrub(newContent.trim());
    if (!oldText) return { success: false, error: "old_text cannot be empty." };
    if (!newContent) {
      return { success: false, error: "new_content cannot be empty. Use 'remove' to delete entries." };
    }

    const scanError = firstThreatMessage(newContent, "strict");
    if (scanError) return { success: false, error: scanError };

    return this.mutateExclusive(() => this.replaceLocked(target, oldText, newContent));
  }

  private async replaceLocked(
    target: MemoryTarget,
    oldText: string,
    newContent: string,
  ): Promise<MemoryResult> {
    await this.reloadTarget(target);
    const entries = [...this.entriesFor(target)];
    const matches = entries.map((e, i) => [i, e] as const).filter(([, e]) => e.includes(oldText));

    if (matches.length === 0) {
      return this.consolidationFailure(target, {
        success: false,
        error: `No entry matched '${oldText}'. Check current_entries below and retry with the exact text of the entry you want to replace.`,
        current_entries: entries,
      });
    }

    let idx = matches[0][0];
    if (matches.length > 1) {
      const unique = new Set(matches.map(([, e]) => e));
      if (unique.size > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Be more specific.`,
          matches: matches.map(([, e]) => (e.length > 80 ? e.slice(0, 80) + "…" : e)),
        };
      }
      idx = matches[0][0];
    }

    const limit = this.charLimit(target);
    const test = [...entries];
    test[idx] = newContent;
    const newTotal = test.join(ENTRY_DELIMITER).length;
    if (newTotal > limit) {
      const current = this.charCount(target);
      return this.consolidationFailure(target, {
        success: false,
        error:
          `Replacement would put memory at ${newTotal}/${limit} chars. ` +
          `Shorten the new content, or 'remove' other stale or less important ` +
          `entries to make room (see current_entries below), then retry — all ` +
          `in this turn.`,
        current_entries: entries,
        usage: `${current}/${limit}`,
      });
    }

    entries[idx] = newContent;
    this.setEntries(target, entries);
    await this.persist(target);
    return this.successResponse(target, "Entry replaced.");
  }

  async remove(target: MemoryTarget, oldText: string): Promise<MemoryResult> {
    oldText = oldText.trim();
    if (!oldText) return { success: false, error: "old_text cannot be empty." };

    return this.mutateExclusive(() => this.removeLocked(target, oldText));
  }

  private async removeLocked(target: MemoryTarget, oldText: string): Promise<MemoryResult> {
    await this.reloadTarget(target);
    const entries = [...this.entriesFor(target)];
    const matches = entries.map((e, i) => [i, e] as const).filter(([, e]) => e.includes(oldText));

    if (matches.length === 0) {
      return {
        success: false,
        error: `No entry matched '${oldText}'. Check current_entries below and retry.`,
        current_entries: entries,
      };
    }
    if (matches.length > 1) {
      const unique = new Set(matches.map(([, e]) => e));
      if (unique.size > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Be more specific.`,
          matches: matches.map(([, e]) => (e.length > 80 ? e.slice(0, 80) + "…" : e)),
        };
      }
    }

    const next = entries.filter((_, i) => i !== matches[0][0]);
    this.setEntries(target, next);
    await this.persist(target);
    return this.successResponse(target, "Entry removed.");
  }

  /**
   * Apply a batch of operations atomically against the final char budget. The
   * whole batch validates before any write, so a single call can free room and
   * add new entries together. All-or-nothing.
   */
  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryResult> {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { success: false, error: "operations must be a non-empty array." };
    }
    return this.mutateExclusive(() => this.applyBatchLocked(target, operations));
  }

  private async applyBatchLocked(
    target: MemoryTarget,
    operations: MemoryOperation[],
  ): Promise<MemoryResult> {
    await this.reloadTarget(target);
    const working = [...this.entriesFor(target)];
    const limit = this.charLimit(target);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i] ?? {};
      const label = `Operation ${i + 1}/${operations.length} (${op.action})`;
      if (op.action === "add") {
        const content = this.scrub((op.content ?? "").trim());
        if (!content) return this.batchError(target, `${label}: content cannot be empty.`);
        const scanError = firstThreatMessage(content, "strict");
        if (scanError) return this.batchError(target, `${label}: ${scanError}`);
        if (!working.includes(content)) working.push(content);
      } else if (op.action === "replace") {
        const oldText = (op.old_text ?? "").trim();
        const content = this.scrub((op.content ?? "").trim());
        if (!oldText) return this.batchError(target, `${label}: old_text cannot be empty.`);
        if (!content) return this.batchError(target, `${label}: content cannot be empty.`);
        const scanError = firstThreatMessage(content, "strict");
        if (scanError) return this.batchError(target, `${label}: ${scanError}`);
        const idx = working.findIndex((e) => e.includes(oldText));
        if (idx === -1) return this.batchError(target, `${label}: no entry matched '${oldText}'.`);
        working[idx] = content;
      } else if (op.action === "remove") {
        const oldText = (op.old_text ?? "").trim();
        if (!oldText) return this.batchError(target, `${label}: old_text cannot be empty.`);
        const idx = working.findIndex((e) => e.includes(oldText));
        if (idx === -1) return this.batchError(target, `${label}: no entry matched '${oldText}'.`);
        working.splice(idx, 1);
      } else {
        return this.batchError(target, `${label}: unknown action '${op.action}'.`);
      }
    }

    const newTotal = working.length === 0 ? 0 : working.join(ENTRY_DELIMITER).length;
    if (newTotal > limit) {
      return this.batchError(
        target,
        `Batch would put memory at ${newTotal}/${limit} chars. Shorten or remove more entries, then retry.`,
      );
    }

    this.setEntries(target, working);
    await this.persist(target);
    return this.successResponse(target, `Applied ${operations.length} operation(s).`);
  }

  private batchError(target: MemoryTarget, message: string): MemoryResult {
    const current = this.charCount(target);
    const limit = this.charLimit(target);
    return {
      success: false,
      error: message + " No operations were applied (batch is all-or-nothing).",
      usage: `${current}/${limit}`,
      current_entries: this.entriesFor(target),
    };
  }

  /** Re-read a target's entries from disk to pick up external writes. */
  private async reloadTarget(target: MemoryTarget): Promise<void> {
    if (!this.loaded) {
      await this.loadFromDisk();
      return;
    }
    const entries = await this.readEntries(target);
    this.setEntries(target, entries);
  }

  /** Live view of entries (tool responses show live state, not the snapshot). */
  getEntries(target: MemoryTarget): string[] {
    return [...this.entriesFor(target)];
  }
}

/**
 * Apply a memory tool payload (single-op or `operations` batch).
 * Used by the live tool handler, curator, and human approval replay.
 */
export async function applyMemoryArgs(
  store: MemoryStore,
  args: Record<string, unknown>,
): Promise<MemoryResult> {
  const target = (args.target as MemoryTarget) ?? "memory";
  if (Array.isArray(args.operations)) {
    return store.applyBatch(target, args.operations as MemoryOperation[]);
  }
  const action = args.action as string | undefined;
  if (action === "list" || action === "get" || action === "read") return store.list(target);
  if (action === "add") return store.add(target, (args.content as string) ?? "");
  if (action === "replace") {
    return store.replace(target, (args.old_text as string) ?? "", (args.content as string) ?? "");
  }
  if (action === "remove") return store.remove(target, (args.old_text as string) ?? "");
  return {
    success: false,
    error:
      `unknown memory action '${action ?? ""}'. ` +
      `Use action=list|add|replace|remove with content/old_text, or an operations array.`,
  };
}
