/**
 * Compact skill index for the frozen system prompt.
 *
 * Port of `build_skills_system_prompt` in vendor/hermes agent/prompt_builder.py,
 * reduced to name + description lines. Upstream keeps the index on because
 * models rarely call `skills_list` to find skills they cannot see. agent-kit
 * makes it opt-in (`config.skillIndex`) so existing prompts do not change.
 */

/** One skill as listed by `SkillLibrary.list()`. */
export interface SkillIndexEntry {
  name: string;
  description: string;
  category?: string;
}

/** Default cap on listed skills. */
export const SKILL_INDEX_LIMIT = 50;
/** Longest description kept per line. Skill descriptions should be 60 chars or fewer. */
const DESCRIPTION_CHARS = 200;

export const SKILL_INDEX_HEADER =
  "# Skill index\n" +
  "These skills exist for this agent. When one matches the task, load it with " +
  "`skill_view` before you answer, and follow it.";

/** Keep a description on one line, and keep it from closing the index fence. */
function cleanDescription(description: string): string {
  const flat = description.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > DESCRIPTION_CHARS ? `${flat.slice(0, DESCRIPTION_CHARS)}…` : flat;
}

/**
 * Build the skill index block. Returns an empty string when there are no skills.
 *
 * @param skills - Skills to list, as returned by `SkillLibrary.list()`.
 * @param limit - Maximum number of skills to list. The rest are counted.
 */
export function buildSkillIndex(skills: SkillIndexEntry[], limit = SKILL_INDEX_LIMIT): string {
  if (skills.length === 0) return "";
  const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const shown = sorted.slice(0, Math.max(0, limit));
  const lines = shown.map((skill) => {
    const description = cleanDescription(skill.description);
    return description ? `- ${skill.name}: ${description}` : `- ${skill.name}`;
  });
  const hidden = sorted.length - shown.length;
  if (hidden > 0) lines.push(`(${hidden} more. Use \`skills_list\` to see them.)`);
  return `${SKILL_INDEX_HEADER}\n<available_skills>\n${lines.join("\n")}\n</available_skills>`;
}
