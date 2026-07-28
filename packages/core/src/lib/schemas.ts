/**
 * OpenAI / Vercel AI SDK tool schemas for the Hermes-compatible tool surface.
 * Names and shapes are kept identical to upstream so prompts and docs stay
 * compatible. Handlers live in `tools.ts`; these are just the JSON schemas.
 */

export const MEMORY_SCHEMA = {
  name: "memory",
  description:
    "Save durable facts to persistent memory that survive across sessions. Memory is " +
    "injected into every future turn, so keep entries compact and high-signal.\n\n" +
    "HOW: make ALL your changes in ONE call via an 'operations' array (each item: " +
    "{action, content?, old_text?}). The batch applies atomically and the char limit is " +
    "checked only on the FINAL result — so a single call can remove/replace stale entries " +
    "to free room AND add new ones, even when an add alone would overflow. The response " +
    "reports current/limit chars and confirms completion; one batch call finishes the " +
    "update, so don't repeat it. Use the bare action/content/old_text fields only for a " +
    "single lone change.\n\n" +
    "WHEN: save proactively when the user states a preference, correction, or personal " +
    "detail, or you learn a stable fact about their environment, conventions, or workflow. " +
    "Priority: user preferences & corrections > environment facts > procedures. The best " +
    "memory stops the user repeating themselves.\n\n" +
    "IF FULL: an add is rejected with the current entries shown. Reissue as ONE batch that " +
    "removes or shortens enough stale entries and adds the new one together.\n\n" +
    "TARGETS: 'user' = who the user is (name, role, preferences, style). 'memory' = your " +
    "notes (environment, conventions, tool quirks, lessons).\n\n" +
    "SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, " +
    "completed-work logs, temporary TODO state (use session_search for those). Reusable " +
    "procedures belong in a skill, not memory.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "replace", "remove"],
        description: "The action to perform (single-op shape). Omit when using 'operations'.",
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
