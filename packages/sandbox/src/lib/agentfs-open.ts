/**
 * Local AgentFS open helpers.
 *
 * Turso/AgentFS takes an exclusive lock on the volume file. Concurrent
 * AgentFS.open() on the same path fails with "database is locked". Overlapping
 * FS ops on one connection are also unsafe. Prefer `openTenantVolume`: one
 * open per path, queued FS methods, kit-ready filesystem methods on the same
 * object.
 *
 * Multi-machine access is deferred. See docs/roadmap/multi-machine.md.
 */

import { AgentFS } from "agentfs-sdk";
import type { FileSystem } from "agentfs-sdk";

function isLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /lock|busy/i.test(msg);
}

export type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

export function createExclusiveQueue(): Exclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

/**
 * Kit-facing tenant volume: one SQLite file, filesystem methods the kit uses,
 * plus the SDK handle for bash when needed.
 */
export interface TenantVolume {
  /** Read a UTF-8 file; return `null` when missing. */
  readFile(path: string): Promise<string | null>;
  /** Create or overwrite a UTF-8 file. */
  writeFile(path: string, content: string): Promise<void>;
  /** List entries in a directory; return `[]` when missing. */
  list(dir: string): Promise<string[]>;
  /** Rename a path within the volume. */
  rename(from: string, to: string): Promise<void>;
  /** Delete a file from the volume. */
  deleteFile(path: string): Promise<void>;
  /** AgentFS SDK handle. Prefer passing `volume` into createTenantBashToolkit. */
  readonly agentFs: AgentFS;
}

/** In-flight opens keyed by path. */
const boots = new Map<string, Promise<AgentFS>>();
/** TenantVolume cache keyed by path (same lifetime as boots). */
const volumes = new Map<string, Promise<TenantVolume>>();
/** FileSystem objects already wrapped by serializeAgentFs. */
const serialized = new WeakSet<object>();

/**
 * Open an AgentFS volume with single-flight + lock retries.
 * FS methods on the handle are queued (safe for concurrent callers).
 * Prefer `openTenantVolume` for host code.
 */
export async function openAgentFs(volumePath: string): Promise<AgentFS> {
  const key = volumePath;
  const existing = boots.get(key);
  if (existing) return existing;

  const boot = (async () => {
    let last: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const afs = await AgentFS.open({ path: volumePath });
        serializeAgentFs(afs.fs);
        return afs;
      } catch (err) {
        last = err;
        if (!isLockError(err) || attempt === 7) throw err;
        await new Promise((r) => setTimeout(r, 40 * 2 ** attempt));
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  })();

  boots.set(key, boot);
  try {
    return await boot;
  } catch (err) {
    boots.delete(key);
    throw err;
  }
}

/**
 * Open one tenant volume for host wiring.
 * Returns a kit-ready filesystem (the volume itself) plus `.agentFs` for bash.
 *
 * @param volumePath - Path to the tenant SQLite file (created if missing).
 * @returns Cached {@link TenantVolume} for this path in the current process.
 */
export async function openTenantVolume(volumePath: string): Promise<TenantVolume> {
  const existing = volumes.get(volumePath);
  if (existing) return existing;

  const boot = (async () => {
    const agentFs = await openAgentFs(volumePath);
    return createTenantVolume(agentFs);
  })();

  volumes.set(volumePath, boot);
  try {
    return await boot;
  } catch (err) {
    volumes.delete(volumePath);
    throw err;
  }
}

/** Build a TenantVolume around an already-open AgentFS handle. */
export function createTenantVolume(agentFs: AgentFS): TenantVolume {
  serializeAgentFs(agentFs.fs);
  const inner = agentFs.fs;
  return {
    agentFs,
    async readFile(path: string): Promise<string | null> {
      try {
        return await inner.readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      await inner.writeFile(path, content, "utf8");
    },
    async list(dir: string): Promise<string[]> {
      try {
        return await inner.readdir(dir);
      } catch {
        return [];
      }
    },
    async rename(from: string, to: string): Promise<void> {
      await inner.rename(from, to);
    },
    async deleteFile(path: string): Promise<void> {
      try {
        await inner.unlink(path);
      } catch {
        // Already gone is fine.
      }
    },
  };
}

/** Clear open caches (tests only). Does not close live handles. */
export function resetAgentFsOpenCache(): void {
  boots.clear();
  volumes.clear();
}

/**
 * Patch AgentFS FileSystem methods so all callers share one exclusive queue.
 * Idempotent: safe to call more than once on the same handle.
 */
export function serializeAgentFs(fs: FileSystem): Exclusive {
  if (serialized.has(fs as object)) {
    return createExclusiveQueue();
  }

  const exclusive = createExclusiveQueue();
  const methods = [
    "readFile",
    "writeFile",
    "readdir",
    "mkdir",
    "rmdir",
    "unlink",
    "rename",
    "stat",
    "lstat",
    "access",
    "copyFile",
    "symlink",
    "readlink",
    "truncate",
    "open",
  ] as const;

  for (const name of methods) {
    const original = (fs as unknown as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    const bound = (original as (...args: unknown[]) => Promise<unknown>).bind(fs);
    (fs as unknown as Record<string, unknown>)[name] = (...args: unknown[]) =>
      exclusive(() => bound(...args));
  }

  serialized.add(fs as object);
  return exclusive;
}
