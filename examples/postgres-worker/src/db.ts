/**
 * The database every process shares. With DATABASE_URL it is that Postgres
 * server (through `pg`); without it, an in-memory PGlite, so the demo and
 * its test run with nothing installed.
 */

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import {
  ensurePostgresSchema,
  fromPg,
  fromPglite,
  type SqlClient,
} from "@socialrobot-io/agent-kit-node/postgres";

export interface Database {
  db: SqlClient;
  /** What the demo prints as its storage. */
  label: string;
  close(): Promise<void>;
}

/**
 * Open the database and create agent-kit's tables if they are missing.
 * In an app, put `postgresSchemaSql()` in your migrations instead.
 *
 * @param url - Postgres connection string. Default `DATABASE_URL`; unset uses PGlite.
 */
export async function openDatabase(url = process.env.DATABASE_URL): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const db = fromPg(pool);
    await ensurePostgresSchema(db);
    return { db, label: "Postgres (DATABASE_URL)", close: () => pool.end() };
  }
  const instance = await PGlite.create();
  const db = fromPglite(instance);
  await ensurePostgresSchema(db);
  return { db, label: "PGlite (in memory)", close: () => instance.close() };
}
