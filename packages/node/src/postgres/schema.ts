/**
 * Table layout for agent-kit state in Postgres.
 *
 * Three tables, every row keyed by `tenant_id`:
 *  - files:    the agent-home filesystem (agent files, memory, skills, pending)
 *  - sessions: one row per chat session
 *  - messages: transcript messages, in append order (`seq`)
 *
 * Only plain columns, a composite primary key per table, and btree indexes,
 * so ORMs (Prisma, Drizzle) can model the tables without drift. No
 * extension is needed.
 */

import type { SqlClient } from "./sql.js";

/** Where the tables live. */
export interface PostgresTableOptions {
  /** Postgres schema for the tables. Default: none (the connection's `search_path`). */
  schema?: string;
  /** Table name prefix. Tables are `${prefix}_files`, `_sessions`, `_messages`. Default `agent_kit`. */
  prefix?: string;
}

/** Resolved, quoted table names. */
export interface PostgresTables {
  /** Quoted name of the files table (with schema when set). */
  files: string;
  /** Quoted name of the sessions table. */
  sessions: string;
  /** Quoted name of the messages table. */
  messages: string;
  /** Unquoted prefix, used to name indexes and lock keys. */
  prefix: string;
  /** Unquoted schema, when set. */
  schema?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

function checkIdent(kind: string, value: string): string {
  if (!IDENT.test(value)) {
    throw new Error(
      `agent-kit postgres: invalid ${kind} '${value}'. Use letters, digits, and underscores (max 41 chars).`,
    );
  }
  return value;
}

const quote = (ident: string) => `"${ident}"`;

/** Validate and quote table names. Throws on an unsafe identifier. */
export function resolveTables(opts: PostgresTableOptions = {}): PostgresTables {
  const prefix = checkIdent("prefix", opts.prefix ?? "agent_kit");
  const schema = opts.schema === undefined ? undefined : checkIdent("schema", opts.schema);
  const name = (table: string) =>
    schema ? `${quote(schema)}.${quote(`${prefix}_${table}`)}` : quote(`${prefix}_${table}`);
  return {
    files: name("files"),
    sessions: name("sessions"),
    messages: name("messages"),
    prefix,
    schema,
  };
}

/**
 * DDL that creates the tables and indexes. Idempotent (`IF NOT EXISTS`).
 * Copy it into your migration tool, or run {@link ensurePostgresSchema}.
 *
 * @returns One statement per array item, without trailing semicolons.
 */
export function postgresSchemaSql(opts: PostgresTableOptions = {}): string[] {
  const t = resolveTables(opts);
  const idx = (name: string) => quote(`${t.prefix}_${name}`);
  return [
    ...(t.schema ? [`CREATE SCHEMA IF NOT EXISTS ${quote(t.schema)}`] : []),
    `CREATE TABLE IF NOT EXISTS ${t.files} (
  tenant_id  text        NOT NULL,
  path       text        NOT NULL,
  content    text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, path)
)`,
    `CREATE TABLE IF NOT EXISTS ${t.sessions} (
  tenant_id  text        NOT NULL,
  id         text        NOT NULL,
  source     text        NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
)`,
    `CREATE INDEX IF NOT EXISTS ${idx("sessions_recent_idx")} ON ${t.sessions} (tenant_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS ${t.messages} (
  tenant_id  text        NOT NULL,
  session_id text        NOT NULL,
  id         text        NOT NULL,
  seq        bigserial   NOT NULL,
  role       text        NOT NULL,
  content    text        NOT NULL,
  tool_calls jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, session_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES ${t.sessions} (tenant_id, id) ON DELETE CASCADE
)`,
    `CREATE INDEX IF NOT EXISTS ${idx("messages_scroll_idx")} ON ${t.messages} (tenant_id, session_id, seq)`,
    `CREATE INDEX IF NOT EXISTS ${idx("messages_recent_idx")} ON ${t.messages} (tenant_id, created_at DESC)`,
  ];
}

/**
 * Create the tables when they do not exist. Fine for development and
 * single-service apps. Prefer your migration tool in production
 * ({@link postgresSchemaSql} gives the DDL).
 */
export async function ensurePostgresSchema(
  db: SqlClient,
  opts: PostgresTableOptions = {},
): Promise<void> {
  const t = resolveTables(opts);
  await db.transaction(async (tx) => {
    // Processes that boot at the same time must not race on CREATE ... IF NOT EXISTS.
    await tx.query("SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext($1::text))", [
      `agent-kit-schema:${t.schema ?? ""}.${t.prefix}`,
    ]);
    for (const statement of postgresSchemaSql(opts)) {
      await tx.query(statement);
    }
  });
}
