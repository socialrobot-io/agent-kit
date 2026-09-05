/**
 * System-prompt guidance paired with default tools.
 *
 * Injected when the matching tool is on the session surface. On by default;
 * hosts opt out via `defineAgent({ config: { toolGuidance: false } })` or
 * per-key flags. Tool schema `description` fields stay the detailed how-to;
 * these blocks are the short behavioral rules.
 */

export type ToolGuidanceKey = "memory" | "skills" | "session_search" | "sandbox";

/** `false` disables all; omit or `true` enables all present tools; object opts out per key. */
export type ToolGuidanceConfig = boolean | Partial<Record<ToolGuidanceKey, boolean>>;

/**
 * Live write-approval flags. Omit or `true` keeps the pending-approval sentence
 * (kit default is gate on). Pass `false` per subsystem so consumer hosts that
 * auto-apply writes do not teach the model `/memory pending`.
 */
export type WriteApprovalGuidance = {
  memory?: boolean;
  skills?: boolean;
};

export const SESSION_SEARCH_GUIDANCE =
  "# Session search\n" +
  "This chat only has the current thread. Earlier chats are not in the prompt. " +
  "When the user asks what you were talking about before, cannot remember a prior " +
  "topic, or refers to another session: say you do not have that thread here, " +
  "offer to check previous chats, and use `session_search` when they agree. " +
  "Prefer browse (no args) or discovery (`query`) over scrolling the current " +
  "session_id — the current chat is already in context and is skipped by default. " +
  "Do not invent a prior conversation.";

export const MEMORY_WRITE_APPROVAL_GUIDANCE =
  "If a write returns staged:true, tell the user it is pending approval — do not claim it is saved.";

export const MEMORY_GUIDANCE_BASE =
  "# Memory\n" +
  "USER PROFILE and MEMORY in this prompt are a frozen snapshot for this session. " +
  "Answer who-am-I / what-do-you-remember from those blocks. Mid-session `memory` " +
  "writes hit disk now and appear in the prompt on the next session; tool responses " +
  "show live disk. Save durable preferences, corrections, and stable facts. Skip " +
  "task progress, one-off narratives, and anything that will be stale in a week — " +
  "use session_search for past transcripts when that tool is available. Never invent " +
  "memories; if the profile is empty, say so in plain text.";

/** Default (gate on): base + pending-approval sentence. */
export const MEMORY_GUIDANCE = `${MEMORY_GUIDANCE_BASE} ${MEMORY_WRITE_APPROVAL_GUIDANCE}`;

export const SKILLS_WRITE_APPROVAL_GUIDANCE =
  "If a write returns staged:true, tell the user it is pending approval.";

export const SKILLS_GUIDANCE_BASE =
  "# Skills\n" +
  "Use skills when one matches the task (`skills_list` → `skill_view`). Load the " +
  "full SKILL.md before following a skill; open linked files under that skill " +
  "directory only when the instructions reference them. After a non-trivial " +
  "workflow or fix, save or patch it with `skill_manage`. New SKILL.md files need " +
  "YAML frontmatter with matching `name` + short `description` (≤60 chars, trigger " +
  "first) and a non-empty body. Prefer patching an existing skill over near-duplicates.";

/** Default (gate on): base + pending-approval sentence. */
export const SKILLS_GUIDANCE = `${SKILLS_GUIDANCE_BASE} ${SKILLS_WRITE_APPROVAL_GUIDANCE}`;

export const SANDBOX_GUIDANCE =
  "# Sandbox\n" +
  "bash / readFile / writeFile operate only inside the tenant sandbox workspace. " +
  "The host machine is not available. Prefer these tools for file and shell work " +
  "in that workspace.";

const GUIDANCE_BY_KEY: Record<
  ToolGuidanceKey,
  { toolNames: readonly string[]; text: string; textOff?: string }
> = {
  memory: {
    toolNames: ["memory"],
    text: MEMORY_GUIDANCE,
    textOff: MEMORY_GUIDANCE_BASE,
  },
  skills: {
    toolNames: ["skills_list", "skill_view", "skill_manage"],
    text: SKILLS_GUIDANCE,
    textOff: SKILLS_GUIDANCE_BASE,
  },
  session_search: { toolNames: ["session_search"], text: SESSION_SEARCH_GUIDANCE },
  sandbox: { toolNames: ["bash", "readFile", "writeFile"], text: SANDBOX_GUIDANCE },
};

const GUIDANCE_ORDER: ToolGuidanceKey[] = [
  "memory",
  "skills",
  "session_search",
  "sandbox",
];

function isKeyEnabled(config: ToolGuidanceConfig, key: ToolGuidanceKey): boolean {
  if (config === false) return false;
  if (config === true) return true;
  return config[key] !== false;
}

/**
 * Build guidance for tools present on the session surface.
 * Empty string when nothing matches or guidance is fully disabled.
 *
 * @param writeApproval - Per-subsystem gate. Omitted / `true` keeps the
 *   pending-approval sentence (default). `false` drops it so hosts that
 *   auto-apply writes do not leak `/memory pending` into user-facing chat.
 */
export function buildToolGuidance(
  toolNames: Iterable<string>,
  config: ToolGuidanceConfig = true,
  writeApproval: WriteApprovalGuidance = {},
): string {
  if (config === false) return "";
  const present = new Set(toolNames);
  const parts: string[] = [];
  for (const key of GUIDANCE_ORDER) {
    if (!isKeyEnabled(config, key)) continue;
    const { toolNames: names, text, textOff } = GUIDANCE_BY_KEY[key];
    if (!names.some((n) => present.has(n))) continue;
    const gateOn = key === "memory" || key === "skills" ? writeApproval[key] !== false : true;
    parts.push(!gateOn && textOff ? textOff : text);
  }
  return parts.join("\n\n");
}
