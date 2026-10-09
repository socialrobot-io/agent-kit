/**
 * Driver-neutral SQL surface for the Postgres adapters.
 *
 * The adapters need two things: run one parameterized statement, and run a
 * function inside one transaction on one connection. {@link SqlClient} is
 * that contract. The `from*` helpers wrap common drivers without importing
 * them, so this package has no runtime database dependency.
 *
 * Every statement the adapters send uses `$1, $2, …` placeholders and
 * explicit casts, and selects only text, int4, float8, and boolean columns,
 * so results look the same on every driver.
 */

/** Runs one parameterized statement. */
export interface SqlQueryable {
  /** Run `text` with `$n` placeholders bound to `params`. Return result rows. */
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** A pool or client that can also run a transaction. */
export interface SqlClient extends SqlQueryable {
  /**
   * Run `fn` inside BEGIN/COMMIT on one connection. Roll back and reject
   * when `fn` rejects.
   */
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
}

// ── node-postgres (pg) and pg-compatible pools ──────────────────────────────

/** Query result shape of node-postgres and pg-compatible drivers. */
export interface PgResultLike {
  rows: unknown[];
}

/** One checked-out connection of a pg-compatible pool. */
export interface PgPoolClientLike {
  query(text: string, params?: unknown[]): Promise<PgResultLike>;
  /** Pass a truthy value to destroy the connection instead of reusing it. */
  release(destroy?: boolean | Error): void;
}

/** A node-postgres `Pool`, or a compatible pool (for example `@neondatabase/serverless`). */
export interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<PgResultLike>;
  connect(): Promise<PgPoolClientLike>;
}

/**
 * Wrap a node-postgres `Pool` (or a compatible pool).
 *
 * ```ts
 * import pg from "pg";
 * const db = fromPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
 * ```
 */
export function fromPg(pool: PgPoolLike): SqlClient {
  const run =
    (target: Pick<PgPoolLike, "query">) =>
    async <Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
      (await target.query(text, params ? [...params] : undefined)).rows as Row[];

  return {
    query: run(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: run(client) });
        await client.query("COMMIT");
        client.release();
        return out;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
          client.release();
        } catch {
          // The connection is in an unknown state: do not return it to the pool.
          client.release(true);
        }
        throw err;
      }
    },
  };
}

// ── Prisma ──────────────────────────────────────────────────────────────────

/** The part of a Prisma interactive-transaction client the adapters use. */
export interface PrismaQueryableLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** The part of a `PrismaClient` the adapters use. */
export interface PrismaLike extends PrismaQueryableLike {
  $transaction<R>(
    fn: (tx: PrismaQueryableLike) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}

/** Options for {@link fromPrisma}. */
export interface FromPrismaOptions {
  /** Max time (ms) to wait for a pooled connection to start a transaction. Default 10000. */
  maxWaitMs?: number;
  /**
   * Max time (ms) a transaction may run. Default 20000. Keep it above the
   * volume `lockTimeoutMs` so a wait for the tenant lock fails first, with a
   * clear error.
   */
  timeoutMs?: number;
}

/**
 * Wrap a `PrismaClient`. Uses `$queryRawUnsafe` with positional parameters
 * and interactive transactions.
 *
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * const db = fromPrisma(new PrismaClient());
 * ```
 */
export function fromPrisma(prisma: PrismaLike, opts: FromPrismaOptions = {}): SqlClient {
  const run =
    (target: PrismaQueryableLike) =>
    async <Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
      target.$queryRawUnsafe<Row[]>(text, ...(params ?? []));

  return {
    query: run(prisma),
    transaction: (fn) =>
      prisma.$transaction((tx) => fn({ query: run(tx) }), {
        maxWait: opts.maxWaitMs ?? 10_000,
        timeout: opts.timeoutMs ?? 20_000,
      }),
  };
}

// ── postgres.js ─────────────────────────────────────────────────────────────

/** The part of a postgres.js `sql` instance the adapters use. */
export interface PostgresJsLike {
  unsafe(query: string, params?: unknown[]): PromiseLike<readonly unknown[]>;
  begin<T>(fn: (sql: PostgresJsLike) => Promise<T>): PromiseLike<T>;
}

/**
 * Wrap a postgres.js `sql` instance.
 *
 * ```ts
 * import postgres from "postgres";
 * const db = fromPostgresJs(postgres(process.env.DATABASE_URL!));
 * ```
 */
export function fromPostgresJs(sql: PostgresJsLike): SqlClient {
  const run =
    (target: PostgresJsLike) =>
    async <Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
      [...(await target.unsafe(text, params ? [...params] : undefined))] as Row[];

  return {
    query: run(sql),
    transaction: async (fn) => sql.begin((tx) => fn({ query: run(tx) })),
  };
}

// ── PGlite ──────────────────────────────────────────────────────────────────

/** One PGlite query target (the instance, or a transaction). */
export interface PgliteQueryableLike {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The part of a PGlite instance the adapters use. */
export interface PgliteLike extends PgliteQueryableLike {
  transaction<T>(fn: (tx: PgliteQueryableLike) => Promise<T>): Promise<T>;
}

/**
 * Wrap a PGlite instance (embedded Postgres in WASM). Good for tests and
 * single-process tools. PGlite runs one statement at a time.
 *
 * ```ts
 * import { PGlite } from "@electric-sql/pglite";
 * const db = fromPglite(await PGlite.create());
 * ```
 */
export function fromPglite(pglite: PgliteLike): SqlClient {
  const run =
    (target: PgliteQueryableLike) =>
    async <Row extends Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
      (await target.query<Row>(text, params ? [...params] : undefined)).rows;

  return {
    query: run(pglite),
    transaction: (fn) => pglite.transaction((tx) => fn({ query: run(tx) })),
  };
}
