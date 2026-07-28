/**
 * Durable TranscriptStore backed by a simple filesystem (AgentFS, disk, …).
 *
 * Layout under `rootDir` (default `sessions/`):
 *   index.json          — Session[] metadata for the volume
 *   {sessionId}.jsonl   — one SessionMessage JSON object per line
 *
 * Tenant isolation: every Session carries tenantId; search/list filter on it.
 * session_id scroll also checks the session belongs to the requesting tenant
 * when used via sessionSearch (caller must pass tenantId).
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

  constructor(options: FileTranscriptStoreOptions) {
    this.fs = options.fs;
    this.rootDir = (options.rootDir ?? "sessions").replace(/\/$/, "");
  }

  private indexPath(): string {
    return `${this.rootDir}/index.json`;
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
        // Corrupt index — start fresh; message files may still be recoverable.
      }
    }
    this.indexLoaded = true;
  }

  private async persistIndex(): Promise<void> {
    const list = [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
    await this.fs.writeFile(this.indexPath(), JSON.stringify(list, null, 2));
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

  private async writeMessages(sessionId: string, messages: SessionMessage[]): Promise<void> {
    const body = messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : "");
    await this.fs.writeFile(this.messagesPath(sessionId), body);
  }

  async createSession(session: Session): Promise<void> {
    await this.loadIndex();
    if (this.sessions.has(session.id)) return;
    this.sessions.set(session.id, session);
    await this.persistIndex();
    const existing = await this.readMessages(session.id);
    if (existing.length === 0) {
      await this.writeMessages(session.id, []);
    }
  }

  async appendMessage(message: SessionMessage): Promise<void> {
    await this.loadIndex();
    if (!this.sessions.has(message.sessionId)) {
      throw new Error(`Unknown session '${message.sessionId}'. Call createSession first.`);
    }
    const list = await this.readMessages(message.sessionId);
    if (list.some((m) => m.id === message.id)) return;
    list.push(message);
    await this.writeMessages(message.sessionId, list);
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
