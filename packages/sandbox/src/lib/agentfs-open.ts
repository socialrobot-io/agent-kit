/**
 * Local AgentFS open + FS serialization helpers.
 *
 * Turso/AgentFS takes an exclusive lock on the volume file. Concurrent
 * AgentFS.open() on the same path fails with "database is locked". Overlapping
 * FS ops on one connection are also unsafe. Use one open per volume per process
 * and serialize all FS method calls.
 *
 * Multi-machine access is deferred — see docs/roadmap/multi-machine.md.
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

/** In-flight opens keyed by absolute/normalized path. */
const boots = new Map<string, Promise<AgentFS>>();

/**
 * Open an AgentFS volume with single-flight + lock retries.
 * Callers must keep one handle per path for the process lifetime.
 */
export async function openAgentFs(volumePath: string): Promise<AgentFS> {
  const key = volumePath;
  const existing = boots.get(key);
  if (existing) return existing;

  const boot = (async () => {
    let last: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        return await AgentFS.open({ path: volumePath });
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

/** Clear the open cache (tests only). Does not close live handles. */
export function resetAgentFsOpenCache(): void {
  boots.clear();
}

/**
 * Patch AgentFS FileSystem methods so all callers (adapters, AgentFsWrapper)
 * share one exclusive queue.
 */
export function serializeAgentFs(fs: FileSystem): Exclusive {
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

  return exclusive;
}
