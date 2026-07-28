/**
 * Seed agent home from on-disk agent/ only when files are absent.
 * Prefer process.cwd() (Next project root) over import.meta.url, which can
 * point into .next after bundling.
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentFsLike } from "@socialrobot-io/agent-kit-core";

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

const SEEDS: { diskRelative: string; volumePath: string; always?: boolean }[] = [
  { diskRelative: "SOUL.md", volumePath: "agent/SOUL.md", always: true },
  { diskRelative: "AGENTS.md", volumePath: "agent/AGENTS.md", always: true },
  {
    diskRelative: "skills/bullet-briefing/SKILL.md",
    volumePath: "skills/bullet-briefing/SKILL.md",
  },
];

export async function examplePackageRoot(): Promise<string> {
  return resolvePackageRoot();
}

export async function seedAgentHome(fs: AgentFsLike): Promise<string[]> {
  const root = await resolvePackageRoot();
  const onDisk = join(root, "agent");
  const written: string[] = [];
  for (const { diskRelative, volumePath, always } of SEEDS) {
    const existing = await fs.readFile(volumePath);
    if (existing != null && !always) continue;
    const content = await readFile(join(onDisk, diskRelative), "utf8");
    if (existing === content) continue;
    await fs.writeFile(volumePath, content);
    written.push(volumePath);
  }
  return written;
}
