/**
 * Install agent identity and skills onto a privileged volume.
 * Call with the raw tenant volume, never with createAgentFs().
 *
 * Hosts pass an {@link AgentBundle} (from compileAgent).
 */

import type { AgentFsLike } from "./agent.js";
import {
  addSkillLocks,
  removeSkillLocks,
  skillFilesMarkLocked,
  SKILL_LOCK_MARKER,
  SKILL_LOCKS_PATH,
} from "./skill-locks.js";

/** File in the agent directory that lists what the last pruning install wrote. */
export const AGENT_BUNDLE_MANIFEST = ".bundle.json";

interface BundleManifest {
  files: string[];
}

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

export interface InstallAgentOptions {
  /** Directory for SOUL.md / AGENTS.md. Default `agent`. */
  agentDir?: string;
  /** Directory for skill folders. Default `skills`. */
  skillsDir?: string;
  /**
   * Delete files that the last pruning install wrote and this bundle no
   * longer has (a removed skill, a renamed reference, a dropped SOUL.md).
   * The list is kept in `{agentDir}/.bundle.json`. Files the bundle never
   * wrote, such as learned skills, stay. Only one bundle per volume may
   * prune: two pruning installs with different bundles delete each other.
   */
  prune?: boolean;
}

export interface InstallAgentResult {
  /** Paths written. */
  written: string[];
  /** Skill names locked by this install. */
  locked: string[];
  /** Paths deleted by `prune`. */
  removed: string[];
}

function isUnderDir(path: string, dir: string): boolean {
  return path.startsWith(`${dir.replace(/\/+$/, "")}/`);
}

async function readManifest(fs: AgentFsLike, path: string): Promise<string[]> {
  const raw = await fs.readFile(path);
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<BundleManifest>;
    return Array.isArray(parsed.files) ? parsed.files.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Write identity + skills to the privileged volume.
 * Agent-tier skills lock only when marked.
 *
 * @param fs - Privileged volume (raw tenant volume, not `createAgentFs`).
 * @param bundle - Compiled agent from `compileAgent` / `loadAgent`.
 * @param options - Directories, and `prune` to delete what the bundle dropped.
 * @returns Paths written and removed, and skill names that were locked.
 */
export async function installAgent(
  fs: AgentFsLike,
  bundle: AgentBundle,
  options: InstallAgentOptions = {},
): Promise<InstallAgentResult> {
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

  const installed = [...written];
  if (lockNames.length) {
    await addSkillLocks(fs, lockNames);
    written.push(SKILL_LOCKS_PATH);
  }

  const removed = options.prune ? await pruneBundle(fs, installed, bundle, agentDir, skillsDir) : [];

  return {
    written,
    locked: [...new Set(lockNames.map((n) => n.trim().toLowerCase()))].sort(),
    removed,
  };
}

/**
 * Delete what the last install wrote and this one did not, unlock skills
 * that are gone, and record the new list. Paths outside the agent and skill
 * directories are never deleted. A failed delete stays in the list, so the
 * next install tries again.
 */
async function pruneBundle(
  fs: AgentFsLike,
  installed: string[],
  bundle: AgentBundle,
  agentDir: string,
  skillsDir: string,
): Promise<string[]> {
  const manifestPath = `${agentDir}/${AGENT_BUNDLE_MANIFEST}`;
  const current = new Set(installed);
  const stale = (await readManifest(fs, manifestPath)).filter(
    (path) =>
      !current.has(path) &&
      path !== manifestPath &&
      path !== SKILL_LOCKS_PATH &&
      (isUnderDir(path, agentDir) || isUnderDir(path, skillsDir)),
  );

  const removed: string[] = [];
  const kept: string[] = [];
  for (const path of stale) {
    if (!fs.deleteFile) {
      kept.push(path);
      continue;
    }
    try {
      await fs.deleteFile(path);
      removed.push(path);
    } catch {
      kept.push(path);
    }
  }

  const bundled = new Set((bundle.skills ?? []).map((s) => s.name.trim().toLowerCase()));
  const skillPrefix = `${skillsDir.replace(/\/+$/, "")}/`;
  const gone = removed
    .filter((path) => isUnderDir(path, skillsDir) && path.endsWith("/SKILL.md"))
    .map((path) => path.slice(skillPrefix.length).split("/")[0]!)
    .filter((name) => !bundled.has(name.toLowerCase()));
  if (gone.length) await removeSkillLocks(fs, gone);

  const manifest: BundleManifest = { files: [...new Set([...installed, ...kept])].sort() };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return removed;
}

/** @deprecated Use {@link AgentBundle}. */
export type SeedCompanyFilesOptions = AgentBundle;
/** @deprecated Use {@link SkillSeed}. */
export type LockedSkillSeed = SkillSeed;
/** @deprecated Use {@link installAgent}. */
export const seedCompanyFiles = installAgent;
