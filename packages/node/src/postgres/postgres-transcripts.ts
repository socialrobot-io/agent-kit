/**
 * Transcript store in Postgres, bound to one tenant.
 *
 * Implements `TranscriptStore` from `@socialrobot-io/agent-kit-sessions`.
 * The store is constructed for one tenant, so tenant isolation does not
 * depend on callers: every statement filters on that tenant, and a call
 * that names another tenant returns nothing (reads) or throws (writes).
 *
 * Search matches a message when it contains the query (case-insensitive,
 * like the file and in-memory stores) or when it matches the query as words
 * (`websearch_to_tsquery('simple', …)`), so "launch plan" also finds
 * "plan for the launch". Hits are newest first. Search reads one tenant's
 * messages; that suits thousands of messages per tenant without a search
 * index.
 */

import {
  searchSnippet,
  type SearchHit,
  type Session,
  type SessionMessage,
  type TranscriptStore,
} from "@socialrobot-io/agent-kit-sessions";
import type { SqlClient } from "./sql.js";
import { resolveTables, type PostgresTableOptions, type PostgresTables } from "./schema.js";

/** Options for {@link PostgresTranscriptStore}. */
export interface PostgresTranscriptStoreOptions extends PostgresTableOptions {
  /** Database client. */
  db: SqlClient;
  /** Tenant this store serves. */
  tenantId: string;
}

interface MessageRow extends Record<string, unknown> {
  session_id: string;
  id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: number;
}

interface SessionRow extends Record<string, unknown> {
  id: string;
  source: string;
  created_at: number;
}

const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined, fallback: number): number {
  const n = Math.floor(limit ?? fallback);
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

export class PostgresTranscriptStore implements TranscriptStore {
  /** Tenant this store serves. */
  readonly tenantId: string;
  private readonly db: SqlClient;
  private readonly tables: PostgresTables;

  constructor(opts: PostgresTranscriptStoreOptions) {
    if (!opts.tenantId?.trim()) throw new Error("PostgresTranscriptStore requires tenantId");
    this.tenantId = opts.tenantId;
    this.db = opts.db;
    this.tables = resolveTables(opts);
  }

  private session(row: SessionRow): Session {
    return {
      id: row.id,
      tenantId: this.tenantId,
      source: row.source,
      createdAt: Number(row.created_at),
    };
  }

  private message(row: MessageRow): SessionMessage {
    const out: SessionMessage = {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as SessionMessage["role"],
      content: row.content,
      createdAt: Number(row.created_at),
    };
    if (row.tool_calls != null) out.toolCalls = JSON.parse(row.tool_calls) as unknown;
    return out;
  }

  async createSession(session: Session): Promise<void> {
    if (session.tenantId !== this.tenantId) {
      throw new Error(
        `Session '${session.id}' is for tenant '${session.tenantId}', not '${this.tenantId}'.`,
      );
    }
    await this.db.query(
      `INSERT INTO ${this.tables.sessions} (tenant_id, id, source, created_at)
       VALUES ($1::text, $2::text, $3::text, to_timestamp($4::float8))
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [this.tenantId, session.id, session.source, session.createdAt],
    );
  }

  async appendMessage(message: SessionMessage): Promise<void> {
    const toolCalls = message.toolCalls === undefined ? null : JSON.stringify(message.toolCalls);
    const inserted = await this.db.query(
      `INSERT INTO ${this.tables.messages}
         (tenant_id, session_id, id, role, content, tool_calls, created_at)
       SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::jsonb, to_timestamp($7::float8)
       WHERE EXISTS (
         SELECT 1 FROM ${this.tables.sessions} WHERE tenant_id = $1::text AND id = $2::text
       )
       ON CONFLICT (tenant_id, session_id, id) DO NOTHING
       RETURNING 1 AS inserted`,
      [
        this.tenantId,
        message.sessionId,
        message.id,
        message.role,
        message.content,
        toolCalls,
        message.createdAt,
      ],
    );
    if (inserted.length > 0) return;
    // Nothing inserted: a duplicate id (fine) or an unknown session (an error).
    if (!(await this.getSession(this.tenantId, message.sessionId))) {
      throw new Error(`Unknown session '${message.sessionId}'. Call createSession first.`);
    }
  }

  async getSession(tenantId: string, sessionId: string): Promise<Session | null> {
    if (tenantId !== this.tenantId) return null;
    const rows = await this.db.query<SessionRow>(
      `SELECT id, source, extract(epoch FROM created_at)::float8 AS created_at
       FROM ${this.tables.sessions}
       WHERE tenant_id = $1::text AND id = $2::text`,
      [this.tenantId, sessionId],
    );
    return rows[0] ? this.session(rows[0]) : null;
  }

  async listSessions(tenantId: string, limit?: number): Promise<Session[]> {
    if (tenantId !== this.tenantId) return [];
    const rows = await this.db.query<SessionRow>(
      `SELECT id, source, extract(epoch FROM created_at)::float8 AS created_at
       FROM ${this.tables.sessions}
       WHERE tenant_id = $1::text
       ORDER BY created_at DESC, id
       ${limit === undefined ? "" : "LIMIT $2::int4"}`,
      limit === undefined ? [this.tenantId] : [this.tenantId, clampLimit(limit, 20)],
    );
    return rows.map((r) => this.session(r));
  }

  async scroll(sessionId: string, offset = 0, limit = 20): Promise<SessionMessage[]> {
    const rows = await this.db.query<MessageRow>(
      `SELECT session_id, id, role, content, tool_calls::text AS tool_calls,
              extract(epoch FROM created_at)::float8 AS created_at
       FROM ${this.tables.messages}
       WHERE tenant_id = $1::text AND session_id = $2::text
       ORDER BY seq
       OFFSET $3::int4 LIMIT $4::int4`,
      [this.tenantId, sessionId, Math.max(0, Math.floor(offset)), clampLimit(limit, 20)],
    );
    return rows.map((r) => this.message(r));
  }

  async search(tenantId: string, query: string, limit = 20): Promise<SearchHit[]> {
    const q = query.trim();
    if (tenantId !== this.tenantId || !q) return [];
    const rows = await this.db.query<MessageRow>(
      `SELECT session_id, id, role, content, NULL::text AS tool_calls,
              extract(epoch FROM created_at)::float8 AS created_at
       FROM ${this.tables.messages}
       WHERE tenant_id = $1::text
         AND (strpos(lower(content), lower($2::text)) > 0
              OR to_tsvector('simple', content) @@ websearch_to_tsquery('simple', $2::text))
       ORDER BY created_at DESC, seq DESC
       LIMIT $3::int4`,
      [this.tenantId, q, clampLimit(limit, 20)],
    );
    return rows.map((r) => ({
      sessionId: r.session_id,
      messageId: r.id,
      role: r.role,
      snippet: searchSnippet(r.content, q),
      createdAt: Number(r.created_at),
    }));
  }

  /** Delete one session and its messages. Returns false when it did not exist. */
  async deleteSession(sessionId: string): Promise<boolean> {
    const rows = await this.db.query(
      `DELETE FROM ${this.tables.sessions} WHERE tenant_id = $1::text AND id = $2::text RETURNING 1 AS deleted`,
      [this.tenantId, sessionId],
    );
    return rows.length > 0;
  }
}
