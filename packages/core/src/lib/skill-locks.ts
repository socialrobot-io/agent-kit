/**
 * Host-owned skill lock registry on the tenant volume.
 *
 * A skill is locked when any of:
 * - name is listed in skills/.locks.json (seed registry)
 * - SKILL.md frontmatter marks locked / pinned / bundled
 * - a `.locked` marker file exists in the skill folder
 *
 * Framework-tier skills are always written into `.locks.json` at seed time.
 * Agent-folder skills are unlocked unless marked. Learned skills are never
 * framework-locked at creation.
 */

import type { SkillsFs } from "./skills.js";

export const SKILL_LOCKS_PATH = "skills/.locks.json";
/** Sidecar marker inside a skill folder (agentskills tree). */
export const SKILL_LOCK_MARKER = ".locked";

export interface SkillLocksFile {
  locked: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function loadSkillLocks(fs: Pick<SkillsFs, "readFile">): Promise<Set<string>> {
  const raw = await fs.readFile(SKILL_LOCKS_PATH);
  if (raw == null || !raw.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw) as SkillLocksFile;
    const list = Array.isArray(parsed.locked) ? parsed.locked : [];
    return new Set(list.map(normalizeName).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function saveSkillLocks(
  fs: Pick<SkillsFs, "writeFile">,
  locked: Iterable<string>,
): Promise<void> {
  const names = [...new Set([...locked].map(normalizeName).filter(Boolean))].sort();
  const body: SkillLocksFile = { locked: names };
  await fs.writeFile(SKILL_LOCKS_PATH, `${JSON.stringify(body, null, 2)}\n`);
}

export async function addSkillLocks(
  fs: Pick<SkillsFs, "readFile" | "writeFile">,
  names: readonly string[],
): Promise<void> {
  const current = await loadSkillLocks(fs);
  for (const n of names) current.add(normalizeName(n));
  await saveSkillLocks(fs, current);
}

/** Frontmatter / meta flags that lock a skill for mutation. */
export function metaMarksLocked(meta: {
  locked?: boolean;
  pinned?: boolean;
  bundled?: boolean;
}): boolean {
  return Boolean(meta.locked || meta.pinned || meta.bundled);
}

export function parseLockFlags(data: Record<string, string>): {
  locked?: boolean;
  pinned?: boolean;
  bundled?: boolean;
} {
  const truthy = (v: string | undefined) => {
    if (v == null) return false;
    const t = v.trim().toLowerCase();
    return t === "true" || t === "yes" || t === "1";
  };
  return {
    locked: truthy(data.locked),
    pinned: truthy(data.pinned),
    bundled: truthy(data.bundled),
  };
}

/** Minimal frontmatter parse for lock flags only (no skills.ts cycle). */
function lockFlagsFromSkillMd(content: string): {
  locked?: boolean;
  pinned?: boolean;
  bundled?: boolean;
} {
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return {};
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return parseLockFlags(data);
}

/** True when a skill file map (host seed) marks the skill locked. */
export function skillFilesMarkLocked(files: Record<string, string>): boolean {
  if (Object.prototype.hasOwnProperty.call(files, SKILL_LOCK_MARKER)) return true;
  const skillMd = files["SKILL.md"];
  if (skillMd == null) return false;
  return metaMarksLocked(lockFlagsFromSkillMd(skillMd));
}

/**
 * True when the skill is locked by registry, `.locked` marker, or protected meta.
 * Used by SkillLibrary and agent-facing path policy.
 */
export async function isSkillNameLocked(
  fs: Pick<SkillsFs, "readFile">,
  skillName: string,
  skillsDir = "skills",
): Promise<boolean> {
  const name = normalizeName(skillName);
  if (!name || name === ".locks.json") return false;
  const locks = await loadSkillLocks(fs);
  if (locks.has(name)) return true;
  const marker = await fs.readFile(`${skillsDir}/${skillName}/${SKILL_LOCK_MARKER}`);
  if (marker != null) return true;
  const raw = await fs.readFile(`${skillsDir}/${skillName}/SKILL.md`);
  if (raw == null) return false;
  return metaMarksLocked(lockFlagsFromSkillMd(raw));
}
