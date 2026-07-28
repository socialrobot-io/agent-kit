/**
 * Write-approval gate + pending store for memory and skill writes.
 *
 * TypeScript port of Nous Research Hermes Agent `tools/write_approval.py` (MIT).
 *
 * The agent writes to two persistent stores that survive across sessions:
 *  - memory — MEMORY.md / USER.md, small declarative entries
 *  - skills — SKILL.md + supporting files, potentially huge
 *
 * Both are written from a foreground turn (user present) or a background_review
 * (autonomous, no user present). The `writeApproval` flag gates those writes:
 *  - false -> write freely
 *  - true  -> stage to a pending store for out-of-band approve / reject
 *
 * Pending records live under `<home>/pending/{memory,skills}/<id>.json` so they
 * survive restarts and can be reviewed from CLI, gateway, or a dashboard.
 */

export type ApprovalSubsystem = "memory" | "skills";
export type WriteOrigin = "foreground" | "background_review";

export interface PendingWriteRecord {
  id: string;
  subsystem: ApprovalSubsystem;
  action: string;
  summary: string;
  origin: WriteOrigin;
  created_at: number;
  /** The exact kwargs needed to replay the write when approved. */
  payload: Record<string, unknown>;
}

/** Filesystem surface for the pending store (same fs as the agent home). */
export interface ApprovalFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile?(path: string): Promise<void>;
  list?(dir: string): Promise<string[]>;
}

export type GateDecision =
  | { kind: "allow" }
  | { kind: "blocked"; message: string }
  | { kind: "stage"; message: string };

export interface GateContext {
  /** Whether the gate is enabled for the subsystem (per-tenant config). */
  writeApprovalEnabled: (subsystem: ApprovalSubsystem) => boolean;
  /** The active write origin. */
  origin: WriteOrigin;
  /** Optional inline approval channel (interactive foreground only). */
  promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
}

/**
 * Decide what to do with a pending write.
 *  gate off                          -> allow
 *  gate on, skills (any origin)      -> stage (too big to review inline)
 *  gate on, background (any)         -> stage
 *  gate on, memory + foreground+inline -> prompt inline; else stage
 */
export function evaluateGate(
  subsystem: ApprovalSubsystem,
  ctx: GateContext,
  inline: { summary?: string; detail?: string } = {},
): GateDecision {
  if (!ctx.writeApprovalEnabled(subsystem)) return { kind: "allow" };

  const background = ctx.origin === "background_review";
  if (subsystem === "skills" || background) {
    const where = subsystem === "skills" ? "/skills pending" : "/memory pending";
    return {
      kind: "stage",
      message: `Staged for approval (${subsystem}.write_approval is on). Not yet saved — review with ${where}.`,
    };
  }

  if (ctx.promptInline) {
    // Caller resolves the promise; a null means the prompt failed -> stage.
    // We signal this by returning stage here and letting stageWrite persist,
    // but the synchronous decision contract returns allow only on explicit
    // approval. For a sync gate we require the async wrapper below.
    return { kind: "stage", message: "Staged for approval (memory.write_approval is on). Not yet saved." };
  }

  return {
    kind: "stage",
    message: "Staged for approval (memory.write_approval is on). Not yet saved — review with /memory pending.",
  };
}

/**
 * Async variant that can resolve an inline prompt for foreground memory writes.
 */
export async function evaluateGateAsync(
  subsystem: ApprovalSubsystem,
  ctx: GateContext,
  inline: { summary?: string; detail?: string } = {},
): Promise<GateDecision> {
  if (!ctx.writeApprovalEnabled(subsystem)) return { kind: "allow" };
  const background = ctx.origin === "background_review";
  if (subsystem === "skills" || background || !ctx.promptInline) {
    return evaluateGate(subsystem, { ...ctx, promptInline: undefined }, inline);
  }
  const granted = await ctx.promptInline(inline.summary ?? "", inline.detail ?? "");
  if (granted === true) return { kind: "allow" };
  if (granted === false) {
    return { kind: "blocked", message: "Memory write denied by user. The change was not saved." };
  }
  return { kind: "stage", message: "Staged for approval (memory.write_approval is on). Not yet saved." };
}

let counter = 0;
function genId(): string {
  // 8-hex-char id similar to Hermes uuid4().hex[:8], collision-safe enough
  // when combined with the per-subsystem directory and timestamp.
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  counter = (counter + 1) % 0xffff;
  return (rand.slice(0, 4) + counter.toString(16).padStart(4, "0")).slice(0, 8);
}

export class PendingWriteStore {
  constructor(
    private readonly fs: ApprovalFs,
    private readonly homeDir = "",
  ) {}

  private pendingDir(subsystem: ApprovalSubsystem): string {
    const base = this.homeDir ? `${this.homeDir}/pending` : "pending";
    return `${base}/${subsystem}`;
  }

  private pathFor(subsystem: ApprovalSubsystem, id: string): string {
    return `${this.pendingDir(subsystem)}/${id}.json`;
  }

  async stage(
    subsystem: ApprovalSubsystem,
    payload: Record<string, unknown>,
    opts: { summary: string; origin: WriteOrigin },
  ): Promise<PendingWriteRecord> {
    const id = genId();
    const record: PendingWriteRecord = {
      id,
      subsystem,
      action: (payload.action as string) ?? "",
      summary: (opts.summary ?? "").trim(),
      origin: opts.origin ?? "foreground",
      created_at: Date.now() / 1000,
      payload,
    };
    await this.fs.writeFile(this.pathFor(subsystem, id), JSON.stringify(record, null, 2));
    return record;
  }

  async list(subsystem: ApprovalSubsystem): Promise<PendingWriteRecord[]> {
    if (!this.fs.list) return [];
    const dir = this.pendingDir(subsystem);
    let names: string[] = [];
    try {
      names = await this.fs.list(dir);
    } catch {
      return [];
    }
    const records: PendingWriteRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const raw = await this.fs.readFile(`${dir}/${name}`);
      if (raw == null) continue;
      try {
        records.push(JSON.parse(raw) as PendingWriteRecord);
      } catch {
        // skip unreadable
      }
    }
    records.sort((a, b) => a.created_at - b.created_at);
    return records;
  }

  async get(subsystem: ApprovalSubsystem, id: string): Promise<PendingWriteRecord | null> {
    const raw = await this.fs.readFile(this.pathFor(subsystem, id));
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as PendingWriteRecord;
    } catch {
      return null;
    }
  }

  async discard(subsystem: ApprovalSubsystem, id: string): Promise<boolean> {
    if (!this.fs.deleteFile) return false;
    const existing = await this.get(subsystem, id);
    if (!existing) return false;
    await this.fs.deleteFile(this.pathFor(subsystem, id));
    return true;
  }

  async count(subsystem: ApprovalSubsystem): Promise<number> {
    return (await this.list(subsystem)).length;
  }
}

/** Build a one-line human gist for a pending skill write (no model call). */
export function skillGist(
  action: string,
  name: string,
  opts: { content?: string; file_path?: string; old_string?: string; new_string?: string } = {},
): string {
  const { content = "", file_path = "", old_string = "", new_string = "" } = opts;
  if ((action === "create" || action === "edit") && content) {
    const desc = frontmatterDescription(content);
    const size = content.length >= 1024 ? `${Math.floor(content.length / 1024) + 1} KB` : `${content.length} chars`;
    const verb = action === "create" ? "create" : "rewrite";
    return desc ? `${verb} '${name}' — ${desc} (${size})` : `${verb} '${name}' (${size})`;
  }
  if (action === "patch") {
    const target = file_path || "SKILL.md";
    const removed = old_string ? old_string.split("\n").length : 0;
    const added = new_string ? new_string.split("\n").length : 0;
    return `patch '${name}' ${target} (+${added}/-${removed} lines)`;
  }
  if (action === "write_file") return `write ${file_path} in '${name}'`;
  if (action === "remove_file") return `remove ${file_path} from '${name}'`;
  if (action === "delete") return `delete skill '${name}'`;
  return `${action} '${name}'`;
}

function frontmatterDescription(content: string): string {
  const m = /^description:\s*(.+)$/m.exec(content);
  if (!m) return "";
  return m[1].trim().replace(/^['"]|['"]$/g, "").slice(0, 140);
}
