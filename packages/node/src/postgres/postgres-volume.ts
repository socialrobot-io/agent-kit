/**
 * One tenant's agent-home filesystem in a Postgres table.
 *
 * Implements the core `AgentFsLike` contract (`readFile` returns `null` for a
 * missing file, `list` returns `[]` for a missing directory, `deleteFile` on
 * a missing path does nothing) plus `exclusive`, so memory and skill edits
 * from many processes do not overwrite each other.
 *
 * Paths are POSIX-style and relative to the tenant root: `/memories/USER.md`
 * and `memories/USER.md` are the same file. Directories are implicit: a
 * directory exists while a file exists under it.
 *
 * How `exclusive` works:
 *  1. A queue per database client and tenant, so one pool holds at most
 *     one connection per tenant while it waits for the lock.
 *  2. A transaction that takes `pg_advisory_xact_lock` for the tenant. Other
 *     processes wait at that statement. COMMIT or ROLLBACK releases it.
 *  3. Calls this volume makes inside the section run on that transaction
 *     (AsyncLocalStorage), so they need no second connection and are atomic:
 *     a rejected section rolls back its writes.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { SqlClient, SqlQueryable } from "./sql.js";
import { resolveTables, type PostgresTableOptions, type PostgresTables } from "./schema.js";

/** Options for {@link PostgresVolume}. */
export interface PostgresVolumeOptions extends PostgresTableOptions {
  /** Database client (see `fromPg`, `fromPrisma`, `fromPostgresJs`, `fromPglite`). */
  db: SqlClient;
  /** Tenant whose files this volume reads and writes. */
  tenantId: string;
  /**
   * Max time (ms) to wait for the tenant lock in `exclusive` before it
   * rejects. Default 10000.
   */
  lockTimeoutMs?: number;
}

/** Active exclusive section: lock key and the transaction that holds it. */
interface Section {
  key: string;
  tx: SqlQueryable;
}

const sections = new AsyncLocalStorage<Section[]>();

/** FIFO tails per database client and lock key. Entries go away when idle. */
const tailsByClient = new WeakMap<object, Map<string, Promise<unknown>>>();

function localExclusive<T>(client: object, key: string, fn: () => Promise<T>): Promise<T> {
  let tails = tailsByClient.get(client);
  if (!tails) {
    tails = new Map();
    tailsByClient.set(client, tails);
  }
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Normalize to a root-relative path. `..` cannot leave the tenant root. */
export function normalizeVolumePath(path: string): string {
  if (path.includes("\u0000")) throw new Error("agent-kit postgres: path contains a NUL byte");
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

function enoent(op: string, path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${path}'`) as Error & {
    code: string;
  };
  err.code = "ENOENT";
  return err;
}

export class PostgresVolume {
  /** Tenant whose files this volume reads and writes. */
  readonly tenantId: string;
  private readonly db: SqlClient;
  private readonly tables: PostgresTables;
  private readonly lockKey: string;
  private readonly lockTimeoutMs: number;

  constructor(opts: PostgresVolumeOptions) {
    if (!opts.tenantId?.trim()) throw new Error("PostgresVolume requires tenantId");
    this.tenantId = opts.tenantId;
    this.db = opts.db;
    this.tables = resolveTables(opts);
    this.lockKey = `agent-kit:${this.tables.schema ?? ""}.${this.tables.prefix}\u0000${opts.tenantId}`;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 10_000;
  }

  /** The transaction of the active section for this tenant, if any. */
  private activeTx(): SqlQueryable | undefined {
    return sections.getStore()?.find((s) => s.key === this.lockKey)?.tx;
  }

  private runner(): SqlQueryable {
    return this.activeTx() ?? this.db;
  }

  /** Run multi-statement work atomically: on the active section, else in a new transaction. */
  private atomic<T>(fn: (q: SqlQueryable) => Promise<T>): Promise<T> {
    const tx = this.activeTx();
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async readFile(path: string): Promise<string | null> {
    const rows = await this.runner().query<{ content: string }>(
      `SELECT content FROM ${this.tables.files} WHERE tenant_id = $1::text AND path = $2::text`,
      [this.tenantId, normalizeVolumePath(path)],
    );
    return rows[0]?.content ?? null;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const p = normalizeVolumePath(path);
    if (!p) throw new Error("agent-kit postgres: cannot write the volume root");
    if (typeof content !== "string") {
      throw new Error("agent-kit postgres: content must be a string (UTF-8 text)");
    }
    await this.runner().query(
      `INSERT INTO ${this.tables.files} (tenant_id, path, content, updated_at)
       VALUES ($1::text, $2::text, $3::text, now())
       ON CONFLICT (tenant_id, path)
       DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [this.tenantId, p, content],
    );
  }

  async list(dir: string): Promise<string[]> {
    const d = normalizeVolumePath(dir);
    const prefix = d ? `${d}/` : "";
    const rows = await this.runner().query<{ name: string }>(
      `SELECT DISTINCT split_part(substr(path, $3::int4), '/', 1) AS name
       FROM ${this.tables.files}
       WHERE tenant_id = $1::text AND starts_with(path, $2::text)
       ORDER BY name`,
      [this.tenantId, prefix, prefix.length + 1],
    );
    return rows.map((r) => r.name).filter(Boolean);
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizeVolumePath(path);
    if (!p) return true;
    const rows = await this.runner().query<{ found: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM ${this.tables.files}
         WHERE tenant_id = $1::text AND (path = $2::text OR starts_with(path, $3::text))
       ) AS found`,
      [this.tenantId, p, `${p}/`],
    );
    return rows[0]?.found === true;
  }

  /** Delete a file, or every file under a directory. A missing path does nothing. */
  async deleteFile(path: string): Promise<void> {
    const p = normalizeVolumePath(path);
    if (!p) throw new Error("agent-kit postgres: cannot delete the volume root");
    await this.runner().query(
      `DELETE FROM ${this.tables.files}
       WHERE tenant_id = $1::text AND (path = $2::text OR starts_with(path, $3::text))`,
      [this.tenantId, p, `${p}/`],
    );
  }

  /** Rename a file or a directory. Replaces what is at `to`. Throws ENOENT when `from` is missing. */
  async rename(from: string, to: string): Promise<void> {
    const src = normalizeVolumePath(from);
    const dst = normalizeVolumePath(to);
    if (!src || !dst) throw new Error("agent-kit postgres: cannot rename the volume root");
    if (src === dst) return;
    if (dst.startsWith(`${src}/`)) {
      throw new Error(`agent-kit postgres: cannot move '${src}' into itself`);
    }
    const t = this.tables.files;
    await this.atomic(async (q) => {
      const file = await q.query<{ found: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${t} WHERE tenant_id = $1::text AND path = $2::text) AS found`,
        [this.tenantId, src],
      );
      if (file[0]?.found) {
        await q.query(
          `DELETE FROM ${t} WHERE tenant_id = $1::text AND (path = $2::text OR starts_with(path, $3::text))`,
          [this.tenantId, dst, `${dst}/`],
        );
        await q.query(
          `UPDATE ${t} SET path = $3::text, updated_at = now() WHERE tenant_id = $1::text AND path = $2::text`,
          [this.tenantId, src, dst],
        );
        return;
      }
      const children = await q.query<{ found: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${t} WHERE tenant_id = $1::text AND starts_with(path, $2::text)) AS found`,
        [this.tenantId, `${src}/`],
      );
      if (!children[0]?.found) throw enoent("rename", from);
      await q.query(
        `DELETE FROM ${t} WHERE tenant_id = $1::text AND (path = $2::text OR starts_with(path, $3::text))`,
        [this.tenantId, dst, `${dst}/`],
      );
      await q.query(
        `UPDATE ${t}
         SET path = $3::text || substr(path, $4::int4), updated_at = now()
         WHERE tenant_id = $1::text AND starts_with(path, $2::text)`,
        [this.tenantId, `${src}/`, `${dst}/`, src.length + 2],
      );
    });
  }

  /**
   * Run `fn` while no other section for this tenant runs, in any process
   * that uses the same tables. Calls this volume makes inside `fn` join the
   * section's transaction; a rejected `fn` rolls them back. Re-entrant: a
   * nested call for the same tenant runs inside the outer section.
   *
   * Keep `fn` short and limited to volume calls. It holds one connection and
   * the tenant lock until it settles.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeTx()) return fn();
    return localExclusive(this.db, this.lockKey, () =>
      this.db.transaction(async (tx) => {
        await tx.query("SELECT set_config('lock_timeout', $1::text, true) AS lock_timeout", [
          `${Math.max(1, Math.floor(this.lockTimeoutMs))}ms`,
        ]);
        await tx.query(
          "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))",
          [`agent-kit:${this.tables.schema ?? ""}.${this.tables.prefix}`, this.tenantId],
        );
        const outer = sections.getStore() ?? [];
        return sections.run([...outer, { key: this.lockKey, tx }], fn);
      }),
    );
  }
}
