/**
 * Integration tests against a real Postgres server, with separate
 * connection pools standing in for separate processes. Skipped unless
 * AGENT_KIT_TEST_DATABASE_URL is set (CI sets it with a Postgres service):
 *
 *   AGENT_KIT_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/db npx nx test postgres
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { MemoryStore } from "@socialrobot-io/agent-kit-core";
import { fromPg, type SqlClient } from "./sql.js";
import { ensurePostgresSchema } from "./schema.js";
import { PostgresVolume } from "./postgres-volume.js";

const url = process.env.AGENT_KIT_TEST_DATABASE_URL;
// A per-run prefix keeps reruns and parallel CI jobs apart.
const prefix = `ak_it_${process.pid}_${Date.now() % 100000}`;

describe.skipIf(!url)("Postgres integration (real server)", () => {
  const pools: pg.Pool[] = [];
  let dbA: SqlClient;
  let dbB: SqlClient;

  beforeAll(async () => {
    const make = () => {
      const pool = new pg.Pool({ connectionString: url, max: 4 });
      pools.push(pool);
      return fromPg(pool);
    };
    dbA = make();
    dbB = make();
    // Two processes booting at once must not race on CREATE TABLE.
    await Promise.all([
      ensurePostgresSchema(dbA, { prefix }),
      ensurePostgresSchema(dbB, { prefix }),
    ]);
  });

  afterAll(async () => {
    if (dbA) {
      for (const table of ["messages", "sessions", "files"]) {
        await dbA.query(`DROP TABLE IF EXISTS "${prefix}_${table}"`);
      }
    }
    await Promise.all(pools.map((p) => p.end()));
  });

  it("keeps every memory write from two processes on one tenant", async () => {
    const tenantId = "it-memory";
    const volumes = [dbA, dbB].map((db) => new PostgresVolume({ db, tenantId, prefix }));
    const stores = volumes.flatMap((v) => [new MemoryStore(v), new MemoryStore(v)]);
    await Promise.all(stores.map((s) => s.loadFromDisk()));

    await Promise.all(
      Array.from({ length: 40 }, (_, i) => stores[i % stores.length]!.add("memory", `fact ${i}`)),
    );

    const check = new MemoryStore(volumes[0]!);
    await check.loadFromDisk();
    expect(new Set(check.getEntries("memory")).size).toBe(40);
  });

  it("makes another process wait for the tenant lock, then time out", async () => {
    const tenantId = "it-lock";
    const holder = new PostgresVolume({ db: dbA, tenantId, prefix });
    const waiter = new PostgresVolume({
      db: dbB,
      tenantId,
      prefix,
      lockTimeoutMs: 200,
    });
    const other = new PostgresVolume({
      db: dbB,
      tenantId: "it-lock-other",
      prefix,
      lockTimeoutMs: 200,
    });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));

    const holding = holder.exclusive(async () => {
      entered();
      await held;
    });
    await inside;

    await expect(waiter.exclusive(async () => "never")).rejects.toThrow(/lock timeout/i);
    // A different tenant is not blocked.
    await expect(other.exclusive(async () => "free")).resolves.toBe("free");

    release();
    await holding;
    await expect(waiter.exclusive(async () => "after")).resolves.toBe("after");
  });
});
