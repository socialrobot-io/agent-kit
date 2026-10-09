/**
 * Test backends: PGlite always (offline, in process), plus a real Postgres
 * server when AGENT_KIT_TEST_DATABASE_URL is set. Contract specs run once
 * per backend, so the SQL is checked on both.
 */

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { fromPg, fromPglite, type SqlClient } from "../src/postgres/sql.js";
import { ensurePostgresSchema, resolveTables } from "../src/postgres/schema.js";

export const TEST_DATABASE_URL = process.env.AGENT_KIT_TEST_DATABASE_URL;

/** Unique per run, so reruns on a shared test database never collide. */
export const runId = `${process.pid}-${Date.now().toString(36)}`;

export interface OpenBackend {
  db: SqlClient;
  close(): Promise<void>;
}

export interface TestBackend {
  name: string;
  open(): Promise<OpenBackend>;
}

const pglite: TestBackend = {
  name: "pglite",
  async open() {
    const instance = await PGlite.create();
    const db = fromPglite(instance);
    await ensurePostgresSchema(db);
    return { db, close: () => instance.close() };
  },
};

const server: TestBackend = {
  name: "postgres",
  async open() {
    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    const db = fromPg(pool);
    await ensurePostgresSchema(db);
    return {
      db,
      async close() {
        // Remove only this run's tenants from the shared test database.
        const t = resolveTables();
        await db.query(`DELETE FROM ${t.files} WHERE strpos(tenant_id, $1::text) > 0`, [runId]);
        await db.query(`DELETE FROM ${t.sessions} WHERE strpos(tenant_id, $1::text) > 0`, [runId]);
        await pool.end();
      },
    };
  },
};

export const backends: TestBackend[] = TEST_DATABASE_URL ? [pglite, server] : [pglite];
