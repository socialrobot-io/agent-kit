/**
 * Seed the agent home from the on-disk `agent/` package directory.
 * Only writes files that are absent so learned state survives re-runs.
 *
 * Layout on volume:
 *   agent/SOUL.md, agent/AGENTS.md  (loaded by AgentSessionRuntime)
 *   skills/<name>/SKILL.md          (SkillLibrary root is `skills/`, not agent/skills/)
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentFsLike } from "@agent-kit/core";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ON_DISK_AGENT = join(PACKAGE_ROOT, "agent");

const SEEDS: { diskRelative: string; volumePath: string }[] = [
  { diskRelative: "SOUL.md", volumePath: "agent/SOUL.md" },
  { diskRelative: "AGENTS.md", volumePath: "agent/AGENTS.md" },
  {
    diskRelative: "skills/bullet-briefing/SKILL.md",
    volumePath: "skills/bullet-briefing/SKILL.md",
  },
];

export function examplePackageRoot(): string {
  return PACKAGE_ROOT;
}

export async function seedAgentHome(fs: AgentFsLike): Promise<string[]> {
  const written: string[] = [];
  for (const { diskRelative, volumePath } of SEEDS) {
    const existing = await fs.readFile(volumePath);
    if (existing != null) continue;
    const content = await readFile(join(ON_DISK_AGENT, diskRelative), "utf8");
    await fs.writeFile(volumePath, content);
    written.push(volumePath);
  }
  return written;
}
