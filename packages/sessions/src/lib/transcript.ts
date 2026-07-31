/**
 * Session transcripts + full-text search (cross-session recall).
 *
 * Port of contracts in `vendor/hermes/hermes_state.py` and
 * `vendor/hermes/tools/session_search_tool.py` (MIT), behind a pluggable store.
 *
 * Upstream uses a local SQLite DB with FTS5. agent-kit's file/in-memory
 * adapters use substring scan (fine for short-lived sessions). Hosts can plug
 * Postgres later. The tool surface (`session_search`) stays the same.
 */

export type SessionSource = "generic" | "mcp" | "composer" | string;

/** One persisted chat message in a transcript. */
export interface SessionMessage {
  /** Stable message id (idempotent append key). */
  id: string;
  /** Chat session this message belongs to. */
  sessionId: string;
  /** Message role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Plain-text content stored for search and curator review. */
  content: string;
  /** Optional tool-call payload (host-defined shape). */
  toolCalls?: unknown;
  /** Unix timestamp (seconds). */
  createdAt: number;
}

/** One chat conversation owned by a tenant. */
export interface Session {
  /** Chat session id. */
  id: string;
  /** Owning tenant. Search never returns hits across tenants. */
  tenantId: string;
  /** How the session was created (e.g. `api`, `composer`). */
  source: SessionSource;
  /** Unix timestamp (seconds) when the session was created. */
  createdAt: number;
}

/** One hit from {@link TranscriptStore.search}. */
export interface SearchHit {
  /** Session containing the match. */
  sessionId: string;
  /** Message that matched. */
  messageId: string;
  /** Role of the matched message. */
  role: string;
  /** Snippet of matching content. */
  snippet: string;
  /** Unix timestamp (seconds) of the matched message. */
  createdAt: number;
}

/**
 * Pluggable transcript store.
 *
 * Prefer one store (and one AgentFS volume) per tenant. When a store holds
 * multiple tenants, every query must filter by tenantId and never leak.
 */
export interface TranscriptStore {
  createSession(session: Session): Promise<void>;
  appendMessage(message: SessionMessage): Promise<void>;
  /** Search across messages for one tenant (substring in built-in adapters). */
  search(tenantId: string, query: string, limit?: number): Promise<SearchHit[]>;
  /** Read a window of messages from a session, oldest-first from offset. */
  scroll(sessionId: string, offset?: number, limit?: number): Promise<SessionMessage[]>;
  /** List sessions for a tenant, newest first. */
  listSessions(tenantId: string): Promise<Session[]>;
}

/**
 * Ensure `sessionId` belongs to `tenantId`. Use before scrolling or returning
 * history to a caller. Throws if the session is missing or owned by another tenant.
 */
export async function assertTenantSession(
  store: TranscriptStore,
  tenantId: string,
  sessionId: string,
): Promise<Session> {
  const sessions = await store.listSessions(tenantId);
  const found = sessions.find((s) => s.id === sessionId);
  if (!found) {
    throw new Error(`Session '${sessionId}' not found for tenant '${tenantId}'.`);
  }
  return found;
}

/** In-memory transcript store with naive substring search (dev / tests). */
export class InMemoryTranscriptStore implements TranscriptStore {
  private sessions = new Map<string, Session>();
  private messages = new Map<string, SessionMessage[]>(); // sessionId -> messages

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    if (!this.messages.has(session.id)) this.messages.set(session.id, []);
  }

  async appendMessage(message: SessionMessage): Promise<void> {
    const list = this.messages.get(message.sessionId) ?? [];
    if (list.some((m) => m.id === message.id)) return;
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

  async listSessions(tenantId: string): Promise<Session[]> {
    return [...this.sessions.values()]
      .filter((s) => s.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** Result shape returned by {@link sessionSearch}. */
export interface SessionSearchResult {
  /** False when the call failed (see `error`). */
  success: boolean;
  /** Which search mode ran. */
  mode?: "discovery" | "scroll" | "browse";
  /** Discovery hits when `query` was set. */
  hits?: SearchHit[];
  /** Scroll window when `session_id` was set. */
  messages?: SessionMessage[];
  /** Browse list when no query / session_id was set. */
  sessions?: Session[];
  /** Failure message when `success` is false. */
  error?: string;
}

/** Arguments for the `session_search` tool / {@link sessionSearch}. */
export interface SessionSearchArgs {
  /** Substring query for discovery across past sessions. */
  query?: string;
  /** Session to scroll when reading one conversation. */
  session_id?: string;
  /** Message offset for scroll (oldest-first). */
  offset?: number;
  /** Max hits / messages / sessions to return. Default 20. */
  limit?: number;
  /** When true, include the active chat in discovery / allow scrolling it. */
  include_current?: boolean;
}

export interface SessionSearchOptions {
  /** Active chat id. Excluded from browse/discovery and blocked for scroll by default. */
  currentSessionId?: string;
}

/**
 * session_search tool handler.
 *
 * - No args → browse: list past sessions (newest first), excluding current.
 * - query → discovery: FTS/substring hits across sessions, excluding current.
 * - session_id → scroll: read a window within one session (current blocked unless
 *   include_current).
 */
export async function sessionSearch(
  store: TranscriptStore,
  tenantId: string,
  args: SessionSearchArgs,
  opts: SessionSearchOptions = {},
): Promise<SessionSearchResult> {
  const limit = args.limit ?? 20;
  const currentId = opts.currentSessionId;
  const includeCurrent = args.include_current === true;

  if (args.session_id) {
    if (currentId && args.session_id === currentId && !includeCurrent) {
      return {
        success: false,
        error:
          "Cannot scroll the current chat — it is already in context. " +
          "Use browse (no args) or discovery (query) for past sessions, " +
          "or pass include_current=true to override.",
      };
    }
    const sessions = await store.listSessions(tenantId);
    if (!sessions.some((s) => s.id === args.session_id)) {
      return { success: false, error: `Session '${args.session_id}' not found for this tenant.` };
    }
    const messages = await store.scroll(args.session_id, args.offset ?? 0, limit);
    return { success: true, mode: "scroll", messages };
  }

  if (args.query) {
    let hits = await store.search(tenantId, args.query, limit * 2);
    if (currentId && !includeCurrent) {
      hits = hits.filter((h) => h.sessionId !== currentId);
    }
    return { success: true, mode: "discovery", hits: hits.slice(0, limit) };
  }

  // Browse: list past sessions, never the active chat (unless include_current).
  let sessions = await store.listSessions(tenantId);
  if (currentId && !includeCurrent) {
    sessions = sessions.filter((s) => s.id !== currentId);
  }
  return { success: true, mode: "browse", sessions: sessions.slice(0, limit) };
}
