/**
 * Durable TranscriptStore backed by a simple filesystem (AgentFS, disk, …).
 *
 * Layout under `rootDir` (default `sessions/`):
 *   index.json          — Session[] metadata for the volume
 *   {sessionId}.jsonl   — one SessionMessage JSON object per line
 *
 * Prefer one FileTranscriptStore per tenant volume. Messages append as JSONL
 * lines (idempotent by message id).
 */

import type {
  SearchHit,
  Session,
  SessionMessage,
  TranscriptStore,
} from "./transcript.js";

/** Minimal async FS surface — satisfied by AgentFS adapters and Node fs wrappers. */
export interface TranscriptFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  list?(dir: string): Promise<string[]>;
  rename?(from: string, to: string): Promise<void>;
}

export interface FileTranscriptStoreOptions {
  fs: TranscriptFs;
  /** Directory relative to the FS root. Default `sessions`. */
  rootDir?: string;
}

export class FileTranscriptStore implements TranscriptStore {
  private readonly fs: TranscriptFs;
  private readonly rootDir: string;
  private indexLoaded = false;
  private sessions = new Map<string, Session>();
  /** sessionId → known message ids (for idempotent append without full rewrite). */
  private messageIds = new Map<string, Set<string>>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: FileTranscriptStoreOptions) {
    this.fs = options.fs;
    this.rootDir = (options.rootDir ?? "sessions").replace(/\/$/, "");
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private indexPath(): string {
    return `${this.rootDir}/index.json`;
  }

  private indexTmpPath(): string {
    return `${this.rootDir}/index.json.tmp`;
  }

  private messagesPath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.rootDir}/${safe}.jsonl`;
  }

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    const raw = await this.fs.readFile(this.indexPath());
    if (raw?.trim()) {
      try {
        const parsed = JSON.parse(raw) as Session[];
        for (const s of parsed) this.sessions.set(s.id, s);
      } catch {
        await this.recoverIndexFromFiles();
      }
    }
    this.indexLoaded = true;
  }

  /** When index.json is corrupt, rebuild from *.jsonl basenames if list() exists. */
  private async recoverIndexFromFiles(): Promise<void> {
    if (!this.fs.list) {
      throw new Error(
        `Corrupt sessions index at ${this.indexPath()} and FS cannot list() to recover.`,
      );
    }
    const names = await this.fs.list(this.rootDir);
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -".jsonl".length);
      if (!this.sessions.has(id)) {
        this.sessions.set(id, {
          id,
          tenantId: "unknown",
          source: "recovered",
          createdAt: Date.now() / 1000,
        });
      }
    }
  }

  private async persistIndex(): Promise<void> {
    const list = [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
    const body = JSON.stringify(list, null, 2);
    if (this.fs.rename) {
      await this.fs.writeFile(this.indexTmpPath(), body);
      await this.fs.rename(this.indexTmpPath(), this.indexPath());
    } else {
      await this.fs.writeFile(this.indexPath(), body);
    }
  }

  private async ensureMessageIds(sessionId: string): Promise<Set<string>> {
    let set = this.messageIds.get(sessionId);
    if (set) return set;
    set = new Set<string>();
    const raw = await this.fs.readFile(this.messagesPath(sessionId));
    if (raw?.trim()) {
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as SessionMessage;
          if (msg.id) set.add(msg.id);
        } catch {
          // skip bad line
        }
      }
    }
    this.messageIds.set(sessionId, set);
    return set;
  }

  private async readMessages(sessionId: string): Promise<SessionMessage[]> {
    const raw = await this.fs.readFile(this.messagesPath(sessionId));
    if (!raw?.trim()) return [];
    const out: SessionMessage[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as SessionMessage);
      } catch {
        // skip bad line
      }
    }
    return out;
  }

  async createSession(session: Session): Promise<void> {
    return this.runExclusive(async () => {
      await this.loadIndex();
      if (this.sessions.has(session.id)) return;
      this.sessions.set(session.id, session);
      await this.persistIndex();
      const existing = await this.fs.readFile(this.messagesPath(session.id));
      if (existing == null) {
        await this.fs.writeFile(this.messagesPath(session.id), "");
      }
      this.messageIds.set(session.id, new Set());
    });
  }

  async appendMessage(message: SessionMessage): Promise<void> {
    return this.runExclusive(async () => {
      await this.loadIndex();
      if (!this.sessions.has(message.sessionId)) {
        throw new Error(`Unknown session '${message.sessionId}'. Call createSession first.`);
      }
      const ids = await this.ensureMessageIds(message.sessionId);
      if (ids.has(message.id)) return;
      const line = `${JSON.stringify(message)}\n`;
      const prev = (await this.fs.readFile(this.messagesPath(message.sessionId))) ?? "";
      await this.fs.writeFile(this.messagesPath(message.sessionId), prev + line);
      ids.add(message.id);
    });
  }

  async search(tenantId: string, query: string, limit = 20): Promise<SearchHit[]> {
    await this.loadIndex();
    const q = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const session of this.sessions.values()) {
      if (session.tenantId !== tenantId) continue;
      const msgs = await this.readMessages(session.id);
      for (const m of msgs) {
        if (m.content.toLowerCase().includes(q)) {
          hits.push({
            sessionId: session.id,
            messageId: m.id,
            role: m.role,
            snippet: this.snippet(m.content, q),
            createdAt: m.createdAt,
          });
        }
      }
    }
    hits.sort((a, b) => b.createdAt - a.createdAt);
    return hits.slice(0, limit);
  }

  private snippet(content: string, q: string, radius = 60): string {
    const i = content.toLowerCase().indexOf(q);
    if (i === -1) return content.slice(0, radius * 2);
    const start = Math.max(0, i - radius);
    const end = Math.min(content.length, i + q.length + radius);
    return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
  }

  async scroll(sessionId: string, offset = 0, limit = 20): Promise<SessionMessage[]> {
    await this.loadIndex();
    const msgs = await this.readMessages(sessionId);
    return msgs.slice(offset, offset + limit);
  }

  async listSessions(tenantId: string): Promise<Session[]> {
    await this.loadIndex();
    return [...this.sessions.values()]
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
