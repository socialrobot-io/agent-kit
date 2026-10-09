/**
 * Storage adapter for `createTenantHome` / `createAgentKit`: files, memory,
 * skills, pending writes, and transcripts in Postgres.
 */

import type { StorageAdapter, TenantStorage } from "../lib/storage.js";
import type { SqlClient } from "./sql.js";
import { ensurePostgresSchema, resolveTables, type PostgresTableOptions } from "./schema.js";
import { PostgresVolume } from "./postgres-volume.js";
import { PostgresTranscriptStore } from "./postgres-transcripts.js";

/** Options for {@link postgresStorage}. */
export interface PostgresStorageOptions extends PostgresTableOptions {
  /** Database client (see `fromPg`, `fromPrisma`, `fromPostgresJs`, `fromPglite`). */
  db: SqlClient;
  /** Max time (ms) to wait for a tenant lock. Default 10000. */
  lockTimeoutMs?: number;
  /**
   * Create the tables on first open (`CREATE TABLE IF NOT EXISTS`). Default
   * false: put `postgresSchemaSql()` in your migrations instead.
   */
  ensureSchema?: boolean;
}

/** One tenant's Postgres storage. */
export interface PostgresTenantStorage extends TenantStorage {
  volume: PostgresVolume;
  transcripts: PostgresTranscriptStore;
}

/** {@link StorageAdapter} whose `open` returns {@link PostgresTenantStorage}. */
export interface PostgresStorageAdapter extends StorageAdapter {
  open(tenantId: string): Promise<PostgresTenantStorage>;
}

/**
 * Postgres storage for agent-kit homes: files, memory, skills, pending
 * writes, and transcripts in three tables shared by every tenant, with
 * `tenant_id` on every row. Many processes and machines can serve the same
 * tenant: memory and skill edits take a per-tenant advisory lock.
 *
 * ```ts
 * import pg from "pg";
 * import { createAgentKit } from "@socialrobot-io/agent-kit-node";
 * import { fromPg, postgresStorage } from "@socialrobot-io/agent-kit-node/postgres";
 *
 * const db = fromPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 * export const kit = createAgentKit({ agent, storage: postgresStorage({ db }), sandbox: false });
 * ```
 */
export function postgresStorage(opts: PostgresStorageOptions): PostgresStorageAdapter {
  const tables = resolveTables(opts);
  const label = `${tables.schema ? `${tables.schema}.` : ""}${tables.prefix}`;
  let schemaReady: Promise<void> | undefined;

  const ready = (): Promise<void> => {
    if (!opts.ensureSchema) return Promise.resolve();
    schemaReady ??= ensurePostgresSchema(opts.db, opts).catch((err: unknown) => {
      schemaReady = undefined;
      throw err;
    });
    return schemaReady;
  };

  return {
    key: (tenantId) => `postgres:${label}\u0000${tenantId}`,
    async open(tenantId) {
      if (!tenantId?.trim()) throw new Error("postgresStorage: tenantId is required");
      await ready();
      const shared = {
        db: opts.db,
        tenantId,
        schema: opts.schema,
        prefix: opts.prefix,
      };
      return {
        volume: new PostgresVolume({
          ...shared,
          lockTimeoutMs: opts.lockTimeoutMs,
        }),
        transcripts: new PostgresTranscriptStore(shared),
        location: `postgres:${label}/${tenantId}`,
      };
    },
  };
}
