/**
 * Session transcripts + full-text search (cross-session recall).
 *
 * Port of the contracts in Nous Research Hermes Agent `hermes_state.py` and
 * `tools/session_search_tool.py` (MIT), behind a pluggable store interface.
 *
 * Hermes uses a local SQLite DB with FTS5. agent-kit abstracts the backend so
 * a SaaS consumer can use Postgres (tsvector / pg_trgm) while local/dev uses
 * an in-memory or SQLite FTS5 adapter. The tool surface (`session_search`)
 * is identical either way.
 */

export type SessionSource = "generic" | "mcp" | "composer" | string;

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: unknown;
  createdAt: number;
}

export interface Session {
  id: string;
  tenantId: string;
  source: SessionSource;
  createdAt: number;
}

export interface SearchHit {
  sessionId: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: number;
}

/**
 * Pluggable transcript store. Implementations must be tenant-scoped: a query
 * for one tenant must never return another tenant's messages.
 */
export interface TranscriptStore {
  createSession(session: Session): Promise<void>;
  appendMessage(message: SessionMessage): Promise<void>;
  /** Full-text search across messages for one tenant. */
  search(tenantId: string, query: string, limit?: number): Promise<SearchHit[]>;
  /** Read a window of messages from a session, oldest-first from offset. */
  scroll(sessionId: string, offset?: number, limit?: number): Promise<SessionMessage[]>;
}

/** In-memory transcript store with naive substring FTS (dev / tests). */
export class InMemoryTranscriptStore implements TranscriptStore {
  private sessions = new Map<string, Session>();
  private messages = new Map<string, SessionMessage[]>(); // sessionId -> messages

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    if (!this.messages.has(session.id)) this.messages.set(session.id, []);
  }

  async appendMessage(message: SessionMessage): Promise<void> {
    const list = this.messages.get(message.sessionId) ?? [];
    list.push(message);
    this.messages.set(message.sessionId, list);
  }

  async search(tenantId: string, query: string, limit = 20): Promise<SearchHit[]> {
    const q = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const [sessionId, msgs] of this.messages) {
      const session = this.sessions.get(sessionId);
      if (!session || session.tenantId !== tenantId) continue;
      for (const m of msgs) {
        if (m.content.toLowerCase().includes(q)) {
          hits.push({
            sessionId,
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
    const msgs = this.messages.get(sessionId) ?? [];
    return msgs.slice(offset, offset + limit);
  }
}

export interface SessionSearchResult {
  success: boolean;
  mode?: "discovery" | "scroll";
  hits?: SearchHit[];
  messages?: SessionMessage[];
  error?: string;
}

/**
 * session_search tool handler (Hermes-compatible). Discovery mode (query)
 * finds matching messages across the tenant's sessions; scroll mode
 * (session_id + offset) reads a window within one session.
 */
export async function sessionSearch(
  store: TranscriptStore,
  tenantId: string,
  args: { query?: string; session_id?: string; offset?: number; limit?: number },
): Promise<SessionSearchResult> {
  const limit = args.limit ?? 20;
  if (args.session_id) {
    const messages = await store.scroll(args.session_id, args.offset ?? 0, limit);
    return { success: true, mode: "scroll", messages };
  }
  if (args.query) {
    const hits = await store.search(tenantId, args.query, limit);
    return { success: true, mode: "discovery", hits };
  }
  return { success: false, error: "Provide 'query' (discovery) or 'session_id' (scroll)." };
}
