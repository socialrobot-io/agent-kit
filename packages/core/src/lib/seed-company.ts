/**
 * Install agent identity and skills onto a privileged volume.
 * Call with the raw tenant volume, never with createAgentFs().
 *
 * Hosts pass an {@link AgentBundle} (from compileAgent).
 */

import type { AgentFsLike } from "./agent.js";
import { addSkillLocks, skillFilesMarkLocked, SKILL_LOCK_MARKER } from "./skill-locks.js";

export interface SkillSeed {
  /** Skill directory name (agentskills `name`). */
  name: string;
  /** Paths relative to `skills/<name>/`. */
  files: Record<string, string>;
  /** Default `agent`. Use `framework` only for kit-owned packs. */
  tier?: "framework" | "agent";
}

/** Compiled agent: SOUL, AGENTS, and agent-folder skills. */
export interface AgentBundle {
  /** Identity markdown written to `agent/SOUL.md`. */
  soul?: string;
  /** House rules written to `agent/AGENTS.md`. */
  agentsMd?: string;
  /** Skills installed under `skills/<name>/`. */
  skills?: SkillSeed[];
}

export { SKILL_LOCK_MARKER };

/**
 * Write identity + skills to the privileged volume.
 * Agent-tier skills lock only when marked.
 *
 * @param fs - Privileged volume (raw tenant volume, not `createAgentFs`).
 * @param bundle - Compiled agent from `compileAgent` / `loadAgent`.
 * @param options.agentDir - Directory for SOUL/AGENTS. Default `agent`.
 * @param options.skillsDir - Directory for skills. Default `skills`.
 * @returns Paths written and skill names that were locked.
 */
export async function installAgent(
  fs: AgentFsLike,
  bundle: AgentBundle,
  options: {
    /** Directory for SOUL.md / AGENTS.md. Default `agent`. */
    agentDir?: string;
    /** Directory for skill folders. Default `skills`. */
    skillsDir?: string;
  } = {},
): Promise<{ written: string[]; locked: string[] }> {
  const agentDir = options.agentDir ?? "agent";
  const skillsDir = options.skillsDir ?? "skills";
  const written: string[] = [];
  const lockNames: string[] = [];

  if (bundle.soul != null) {
    const path = `${agentDir}/SOUL.md`;
    await fs.writeFile(path, bundle.soul);
    written.push(path);
  }
  if (bundle.agentsMd != null) {
    const path = `${agentDir}/AGENTS.md`;
    await fs.writeFile(path, bundle.agentsMd);
    written.push(path);
  }

  for (const skill of bundle.skills ?? []) {
    const name = skill.name.trim();
    if (!name) continue;
    const tier = skill.tier ?? "agent";
    for (const [rel, content] of Object.entries(skill.files)) {
      const path = `${skillsDir}/${name}/${rel.replace(/^\/+/, "")}`;
      await fs.writeFile(path, content);
      written.push(path);
    }
    if (tier === "framework" || skillFilesMarkLocked(skill.files)) {
      lockNames.push(name);
    }
  }

  if (lockNames.length) {
    await addSkillLocks(fs, lockNames);
    written.push("skills/.locks.json");
  }

  return {
    written,
    locked: [...new Set(lockNames.map((n) => n.trim().toLowerCase()))].sort(),
  };
}

/** @deprecated Use {@link AgentBundle}. */
export type SeedCompanyFilesOptions = AgentBundle;
/** @deprecated Use {@link SkillSeed}. */
export type LockedSkillSeed = SkillSeed;
/** @deprecated Use {@link installAgent}. */
export const seedCompanyFiles = installAgent;
