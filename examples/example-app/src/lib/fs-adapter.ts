/**
 * Adapts agentfs-sdk's FileSystem to @socialrobot-io/agent-kit-core's AgentFsLike.
 * Call serializeAgentFs(afs.fs) from @socialrobot-io/agent-kit-sandbox before adapting.
 */

import type { FileSystem } from "agentfs-sdk";
import type { AgentFsLike } from "@socialrobot-io/agent-kit-core";

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
