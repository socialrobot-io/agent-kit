import { describe, it, expect } from "vitest";
import {
  fromPg,
  fromPostgresJs,
  fromPrisma,
  type PgPoolClientLike,
  type PostgresJsLike,
  type PrismaQueryableLike,
} from "./sql.js";
import { postgresSchemaSql, resolveTables } from "./schema.js";

describe("fromPg", () => {
  function fakePool(failOn?: string) {
    const log: string[] = [];
    const released: unknown[] = [];
    const client: PgPoolClientLike = {
      async query(text, params) {
        log.push(params ? `${text} ${JSON.stringify(params)}` : text);
        if (failOn && text.startsWith(failOn)) throw new Error(`fail ${failOn}`);
        return { rows: [{ ok: 1 }] };
      },
      release(destroy) {
        released.push(destroy ?? false);
      },
    };
    return {
      log,
      released,
      pool: {
        query: async (text: string) => {
          log.push(`pool ${text}`);
          return { rows: [{ n: 1 }] };
        },
        connect: async () => client,
      },
    };
  }

  it("returns rows and commits a transaction on one connection", async () => {
    const f = fakePool();
    const db = fromPg(f.pool);
    expect(await db.query("SELECT 1")).toEqual([{ n: 1 }]);
    const out = await db.transaction(async (tx) => tx.query("SELECT $1::int4", [7]));
    expect(out).toEqual([{ ok: 1 }]);
    expect(f.log).toEqual(["pool SELECT 1", "BEGIN", "SELECT $1::int4 [7]", "COMMIT"]);
    expect(f.released).toEqual([false]);
  });

  it("rolls back and rethrows when the work fails", async () => {
    const f = fakePool();
    const db = fromPg(f.pool);
    await expect(
      db.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(f.log).toEqual(["BEGIN", "ROLLBACK"]);
    expect(f.released).toEqual([false]);
  });

  it("destroys the connection when ROLLBACK itself fails", async () => {
    const f = fakePool("ROLLBACK");
    const db = fromPg(f.pool);
    await expect(
      db.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(f.released).toEqual([true]);
  });
});

describe("fromPrisma", () => {
  it("spreads parameters and passes transaction timeouts", async () => {
    const calls: unknown[][] = [];
    const tx: PrismaQueryableLike = {
      async $queryRawUnsafe<T>(query: string, ...values: unknown[]) {
        calls.push(["tx", query, ...values]);
        return [{ ok: 1 }] as T;
      },
    };
    let txOptions: unknown;
    const prisma = {
      async $queryRawUnsafe<T>(query: string, ...values: unknown[]) {
        calls.push(["root", query, ...values]);
        return [{ n: 1 }] as T;
      },
      async $transaction<R>(fn: (t: PrismaQueryableLike) => Promise<R>, options?: unknown) {
        txOptions = options;
        return fn(tx);
      },
    };
    const db = fromPrisma(prisma, { timeoutMs: 30_000 });
    expect(await db.query("SELECT $1::text, $2::int4", ["a", 2])).toEqual([{ n: 1 }]);
    expect(await db.transaction((t) => t.query("SELECT 1"))).toEqual([{ ok: 1 }]);
    expect(calls).toEqual([
      ["root", "SELECT $1::text, $2::int4", "a", 2],
      ["tx", "SELECT 1"],
    ]);
    expect(txOptions).toEqual({ maxWait: 10_000, timeout: 30_000 });
  });
});

describe("fromPostgresJs", () => {
  it("uses unsafe() with parameters and begin() for transactions", async () => {
    const calls: unknown[] = [];
    const sql: PostgresJsLike = {
      async unsafe(query: string, params?: unknown[]) {
        calls.push([query, params]);
        return [{ ok: 1 }];
      },
      async begin<T>(fn: (s: PostgresJsLike) => Promise<T>) {
        calls.push("begin");
        return fn(sql);
      },
    };
    const db = fromPostgresJs(sql);
    expect(await db.transaction((tx) => tx.query("SELECT $1::text", ["x"]))).toEqual([{ ok: 1 }]);
    expect(calls).toEqual(["begin", ["SELECT $1::text", ["x"]]]);
  });
});

describe("schema", () => {
  it("quotes names, supports a schema, and rejects unsafe identifiers", () => {
    expect(resolveTables().files).toBe('"agent_kit_files"');
    expect(resolveTables({ schema: "agents", prefix: "ak" }).messages).toBe(
      '"agents"."ak_messages"',
    );
    expect(() => resolveTables({ prefix: 'x"; DROP TABLE users; --' })).toThrow(/invalid prefix/);
    expect(() => resolveTables({ schema: "a.b" })).toThrow(/invalid schema/);
  });

  it("emits idempotent DDL with no extension", () => {
    const sql = postgresSchemaSql({ schema: "agents" });
    expect(sql[0]).toBe('CREATE SCHEMA IF NOT EXISTS "agents"');
    expect(sql.every((s) => /IF NOT EXISTS/.test(s))).toBe(true);
    expect(sql.join("\n")).not.toMatch(/CREATE EXTENSION/);
  });
});
