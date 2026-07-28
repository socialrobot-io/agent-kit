/**
 * Adapts agentfs-sdk's Node-like FileSystem to @agent-kit/core's AgentFsLike.
 *
 * AgentFS: readFile/writeFile/readdir/unlink/rename (throws on missing paths).
 * AgentFsLike: readFile => null on miss, list => [] on miss, optional deleteFile.
 */

import type { FileSystem } from "agentfs-sdk";
import type { AgentFsLike } from "@agent-kit/core";

export type AgentFsAdapter = AgentFsLike & {
  deleteFile(path: string): Promise<void>;
};

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
      // AgentFS writeFile creates parent directories when they are missing.
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

    // PendingWriteStore.discard and SkillLibrary.delete* need this.
    async deleteFile(path: string): Promise<void> {
      try {
        await fs.unlink(path);
      } catch {
        // Already gone is fine for discard/remove.
      }
    },
  };
}
