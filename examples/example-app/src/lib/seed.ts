/**
 * Re-install an agent directory onto the privileged volume (HMR / long-lived process).
 * Boot uses createTenantHome({ agent }) from the compiled bundle; this helper
 * refreshes from disk when opening a new chat after files change.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";
import { installAgent, type AgentFsLike } from "@socialrobot-io/agent-kit-core";
import { loadAgent } from "@socialrobot-io/agent-kit-node";

async function resolvePackageRoot(): Promise<string> {
  const candidates = [
    process.cwd(),
    join(process.cwd(), "examples/example-app"),
  ];
  for (const root of candidates) {
    try {
      await access(join(root, "agent/SOUL.md"));
      return root;
    } catch {
      // try next
    }
  }
  return process.cwd();
}

export async function examplePackageRoot(): Promise<string> {
  return resolvePackageRoot();
}

/**
 * @param fs - Privileged tenant volume
 * @param agentDir - Path relative to the example-app root (default `agent`)
 */
export async function seedAgentHome(
  fs: AgentFsLike,
  agentDir = "agent",
): Promise<string[]> {
  const root = await resolvePackageRoot();
  const { written } = await installAgent(fs, await loadAgent(join(root, agentDir)));
  return written;
}
