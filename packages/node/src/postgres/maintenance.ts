/**
 * Operator helpers: delete a tenant, and prune old transcripts.
 *
 * These are host-level maintenance calls, not agent tools. Run them from
 * account deletion flows, retention jobs, or scripts.
 */

import type { SqlClient } from "./sql.js";
import { resolveTables, type PostgresTableOptions } from "./schema.js";

/** Rows removed by {@link deletePostgresTenant}. */
export interface DeletedTenant {
  /** Files removed (agent files, memory, skills, pending writes). */
  files: number;
  /** Sessions removed. Their messages go with them. */
  sessions: number;
}

/**
 * Delete everything stored for one tenant: files and transcripts. Use it
 * when the tenant (an account, a workspace, a project) is deleted.
 */
export async function deletePostgresTenant(
  db: SqlClient,
  tenantId: string,
  opts: PostgresTableOptions = {},
): Promise<DeletedTenant> {
  if (!tenantId?.trim()) throw new Error("deletePostgresTenant: tenantId is required");
  const t = resolveTables(opts);
  return db.transaction(async (tx) => {
    const files = await tx.query<{ n: number }>(
      `WITH d AS (DELETE FROM ${t.files} WHERE tenant_id = $1::text RETURNING 1)
       SELECT count(*)::int4 AS n FROM d`,
      [tenantId],
    );
    const sessions = await tx.query<{ n: number }>(
      `WITH d AS (DELETE FROM ${t.sessions} WHERE tenant_id = $1::text RETURNING 1)
       SELECT count(*)::int4 AS n FROM d`,
      [tenantId],
    );
    return {
      files: Number(files[0]?.n ?? 0),
      sessions: Number(sessions[0]?.n ?? 0),
    };
  });
}

/** Options for {@link prunePostgresTranscripts}. */
export interface PruneTranscriptsOptions extends PostgresTableOptions {
  /** Remove sessions with no message at or after this time. */
  inactiveBefore: Date;
  /** Limit the prune to one tenant. Default: every tenant. */
  tenantId?: string;
}

/**
 * Delete sessions (and their messages) that had no activity since
 * `inactiveBefore`: created before it, with no message at or after it.
 * Use it for transcript retention.
 *
 * @returns The number of sessions removed.
 */
export async function prunePostgresTranscripts(
  db: SqlClient,
  opts: PruneTranscriptsOptions,
): Promise<number> {
  const t = resolveTables(opts);
  const cutoff = opts.inactiveBefore.getTime() / 1000;
  if (!Number.isFinite(cutoff)) throw new Error("prunePostgresTranscripts: invalid inactiveBefore");
  const rows = await db.query<{ n: number }>(
    `WITH d AS (
       DELETE FROM ${t.sessions} s
       WHERE s.created_at < to_timestamp($1::float8)
         AND ($2::text IS NULL OR s.tenant_id = $2::text)
         AND NOT EXISTS (
           SELECT 1 FROM ${t.messages} m
           WHERE m.tenant_id = s.tenant_id AND m.session_id = s.id
             AND m.created_at >= to_timestamp($1::float8)
         )
       RETURNING 1
     )
     SELECT count(*)::int4 AS n FROM d`,
    [cutoff, opts.tenantId ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}
