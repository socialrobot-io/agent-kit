/**
 * Adapts agentfs-sdk's FileSystem to @agent-kit/core's AgentFsLike.
 */

import type { FileSystem } from "agentfs-sdk";
import type { AgentFsLike } from "@agent-kit/core";

export type AgentFsAdapter = AgentFsLike & {
  deleteFile(path: string): Promise<void>;
};

type Exclusive = <T>(fn: () => Promise<T>) => Promise<T>;

function createMutex(): Exclusive {
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
 * Patch AgentFS FileSystem methods so memory, transcripts, and the just-bash
 * AgentFsWrapper share one queue. Turso rejects overlapping ops / second opens
 * with "database is locked".
 */
export function serializeAgentFs(fs: FileSystem): Exclusive {
  const exclusive = createMutex();
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

export function adaptAgentFs(fs: FileSystem): AgentFsAdapter {
  return {
    async readFile(path: string): Promise<string | null> {
      try {
        return await fs.readFile(path, "utf8");
      } catch {
        return null;
      }
    },

    async writeFile(path: string, content: string): Promise<void> {
      await fs.writeFile(path, content, "utf8");
    },

    async list(dir: string): Promise<string[]> {
      try {
        return await fs.readdir(dir);
      } catch {
        return [];
      }
    },

    async rename(from: string, to: string): Promise<void> {
      await fs.rename(from, to);
    },

    async deleteFile(path: string): Promise<void> {
      try {
        await fs.unlink(path);
      } catch {
        // Already gone is fine.
      }
    },
  };
}
