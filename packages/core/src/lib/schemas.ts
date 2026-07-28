/**
 * OpenAI / Vercel AI SDK tool schemas for the Hermes-compatible tool surface.
 * Names and shapes are kept identical to upstream so prompts and docs stay
 * compatible. Handlers live in `tools.ts`; these are just the JSON schemas.
 */

export const MEMORY_SCHEMA = {
  name: "memory",
  description:
    "Save durable facts to persistent memory that survive across sessions. At " +
    "session start, MEMORY.md and USER.md are injected into the system prompt as a " +
    "FROZEN snapshot and never change mid-session — that preserves the LLM prefix " +
    "cache. Writes still persist to disk immediately; they appear in the prompt on " +
    "the NEXT session. Tool responses always reflect live disk state.\n\n" +
    "Answer 'who am I' / 'what do you remember' from the USER PROFILE / MEMORY blocks " +
    "in the system prompt. Do NOT add entries that say you don't know the user.\n\n" +
    "ACTIONS: add, replace, remove (mutate). Optional list = read live entries without " +
    "changing the frozen prompt. Prefer an 'operations' array for multiple writes: " +
    "each item is {action, content?, old_text?}; batches apply atomically and the char " +
    "limit is checked only on the FINAL result.\n\n" +
    "WHEN TO WRITE: the user states a preference, correction, or personal detail, or you " +
    "learn a stable environment/convention fact. Priority: user preferences & corrections > " +
    "environment facts > procedures.\n\n" +
    "IF FULL: an add is rejected with current_entries shown. Reissue as ONE batch that " +
    "removes or shortens enough stale entries and adds the new one together.\n\n" +
    "TARGETS: 'user' = who the user is. 'memory' = your notes (environment, conventions).\n\n" +
    "SKIP: trivial/obvious info, easily re-discovered facts, raw dumps, task progress, " +
    "temporary TODO state. Reusable procedures belong in a skill.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "add", "replace", "remove"],
        description:
          "list = read live entries (no write; does not change the frozen prompt). " +
          "add/replace/remove = mutate disk. Omit when using 'operations'.",
      },
      target: {
        type: "string",
        enum: ["memory", "user"],
        description: "Which memory store: 'memory' for personal notes, 'user' for user profile.",
      },
      content: {
        type: "string",
        description: "The entry content. Required for 'add' and 'replace' (single-op shape).",
      },
      old_text: {
        type: "string",
        description:
          "REQUIRED for 'replace' and 'remove' (single-op shape): a short unique substring identifying the existing entry to modify. Omit only for 'add'.",
      },
      operations: {
        type: "array",
        description:
          "Batch shape: a list of operations applied atomically in one call against the final char budget. Preferred when making multiple changes or consolidating to make room. Each item is {action, content?, old_text?}.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "replace", "remove"] },
            content: { type: "string", description: "Entry content for add/replace." },
            old_text: { type: "string", description: "Substring identifying the entry for replace/remove." },
          },
          required: ["action"],
        },
      },
    },
    required: ["target"],
  },
} as const;

export const SKILLS_LIST_SCHEMA = {
  name: "skills_list",
  description: "List available skills (name + description). Use skill_view(name) to load full content.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", description: "Optional category filter to narrow results" },
    },
    required: [] as string[],
  },
} as const;

export const SKILL_VIEW_SCHEMA = {
  name: "skill_view",
  description:
    "Skills allow for loading information about specific tasks and workflows, as well as scripts and templates. " +
    "Load a skill's full content or access its linked files (references, templates, scripts). First call returns " +
    "SKILL.md content plus a 'linked_files' dict showing available references/templates/scripts. To access those, " +
    "call again with file_path parameter.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name (use skills_list to see available skills).",
      },
      file_path: {
        type: "string",
        description:
          "OPTIONAL: Path to a linked file within the skill (e.g., 'references/api.md', 'templates/config.yaml', 'scripts/validate.py'). Omit to get the main SKILL.md content.",
      },
    },
    required: ["name"],
  },
} as const;

export const SKILL_MANAGE_SCHEMA = {
  name: "skill_manage",
  description:
    "Create, update, and delete your own skills — your procedural memory. When you figure out a non-trivial " +
    "workflow, save the approach as a skill for future reuse. Actions: create (full SKILL.md), edit (rewrite " +
    "SKILL.md), patch (targeted string replace), delete, write_file / remove_file (supporting files under " +
    "references/, templates/, scripts/).",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "edit", "patch", "delete", "write_file", "remove_file"],
        description: "The skill operation to perform.",
      },
      name: { type: "string", description: "The skill name." },
      content: {
        type: "string",
        description: "Full SKILL.md text (frontmatter + body). Required for 'create' and 'edit'.",
      },
      old_string: { type: "string", description: "Text to find. Required for 'patch'." },
      new_string: { type: "string", description: "Replacement text for 'patch'." },
      replace_all: { type: "boolean", description: "For 'patch': replace all occurrences." },
      category: { type: "string", description: "Optional category/domain for grouping. Only used on 'create'." },
      file_path: {
        type: "string",
        description: "Path to a supporting file (e.g., 'references/api.md'). Required for 'write_file'/'remove_file', optional for 'patch'.",
      },
      file_content: { type: "string", description: "Content for 'write_file'." },
    },
    required: ["action", "name"],
  },
} as const;

export const SESSION_SEARCH_SCHEMA = {
  name: "session_search",
  description:
    "Search past conversation sessions with full-text search. Returns actual messages from the transcript " +
    "store — no summarization. Use discovery mode (query) to find sessions, scroll mode to read forward/" +
    "backward within a session.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "FTS query for discovery mode." },
      session_id: { type: "string", description: "Session to scroll/browse (scroll/browse mode)." },
      offset: { type: "number", description: "Message offset for scroll mode." },
      limit: { type: "number", description: "Max messages to return (default 20)." },
    },
    required: [] as string[],
  },
} as const;
