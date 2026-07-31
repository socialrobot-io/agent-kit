/**
 * Agent definition + agent/ directory discovery.
 *
 * A project authors an agent as a directory:
 *   agent/
 *     agent.ts          -> defineAgent({ model, ... })
 *     SOUL.md           -> identity (always-on system prompt slot #1)
 *     AGENTS.md         -> persistent context / instructions
 *     skills/           -> on-demand procedures (agentskills.io)
 *     memories/         -> MEMORY.md / USER.md (curated memory)
 *
 * Custom tools are registered in code (`addTools` / composition helper), not
 * loaded from an `agent/tools/` directory.
 *
 * The runtime loads SOUL.md + AGENTS.md + a frozen MEMORY/USER snapshot into
 * the system prompt, and registers memory/skills tools plus session_search /
 * sandbox when the host wires them via composition.
 */

import type { MemoryFs } from "./memory.js";

export interface AgentDefinition {
  /** Model identifier (gateway id or provider id). */
  model: string;
  /** Optional reasoning effort hint. */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high";
  /** Free-form description (used for subagent delegation). */
  description?: string;
  /** Per-tenant config overrides. */
  config?: {
    /** Max characters for MEMORY.md in the system-prompt snapshot. */
    memoryCharLimit?: number;
    /** Max characters for USER.md in the system-prompt snapshot. */
    userCharLimit?: number;
    /**
     * Write-approval gate per subsystem. Both default to `true` in
     * {@link defineAgent} unless you set them explicitly.
     */
    writeApproval?: {
      /** Stage memory writes for human approval. Default true. */
      memory?: boolean;
      /** Stage skill writes for human approval. Default true. */
      skills?: boolean;
    };
    /** Host hint that sandbox tools should be wired. Not enforced by core. */
    sandboxEnabled?: boolean;
    /**
     * Inject short behavioral guidance for tools present on the session.
     * `false` disables all; omit/`true` enables defaults; object opts out per key.
     */
    toolGuidance?: boolean | Partial<Record<"memory" | "skills" | "session_search" | "sandbox", boolean>>;
    /**
     * After each completed turn, run the background curator
     * (`createTenantHome` wires this). Default `true` in {@link defineAgent}.
     * Pass `false` to disable, or `{ mode }` to review memory, skills, or both.
     */
    curator?: boolean | { mode?: "memory" | "skills" | "combined" };
  };
}

/**
 * Normalize an agent definition (secure-by-default write approval + curator).
 *
 * @param def - Author-supplied definition (`model` required).
 * @returns Definition with `config.writeApproval` and `config.curator` defaults.
 */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  if (!def.model) throw new Error("defineAgent requires a model");
  // Secure-by-default: write approval on unless the host explicitly sets flags.
  const writeApproval = def.config?.writeApproval;
  const curator = def.config?.curator;
  return {
    ...def,
    config: {
      ...def.config,
      writeApproval: {
        memory: writeApproval?.memory ?? true,
        skills: writeApproval?.skills ?? true,
      },
      curator:
        curator === false
          ? false
          : typeof curator === "object"
            ? { mode: curator.mode ?? "combined" }
            : true,
    },
  };
}

/** Markdown context loaded from the agent home directory. */
export interface AgentFiles {
  /** Contents of `SOUL.md` (identity; always in the system prompt). */
  soul?: string;
  /** Contents of `AGENTS.md` (house rules / persistent context). */
  agentsMd?: string;
}

/**
 * Filesystem contract for agent home state.
 * `readFile` returns `null` on missing files; `list` returns `[]` on missing dirs.
 */
export interface AgentFsLike extends MemoryFs {
  /** List entries in a directory; return `[]` when missing. */
  list(dir: string): Promise<string[]>;
  /** Delete a file. Required for pending discard and skill deletion. */
  deleteFile?(path: string): Promise<void>;
}

/**
 * Discover and load the agent/ directory's markdown context from the agent
 * home filesystem. SOUL.md is the identity; AGENTS.md is persistent context.
 */
export async function loadAgentFiles(fs: AgentFsLike, agentDir = "agent"): Promise<AgentFiles> {
  const soul =
    (await fs.readFile(`${agentDir}/SOUL.md`)) ??
    (await fs.readFile(`${agentDir}/instructions.md`)) ??
    undefined;
  const agentsMd = (await fs.readFile(`${agentDir}/AGENTS.md`)) ?? undefined;
  return { soul: soul ?? undefined, agentsMd: agentsMd ?? undefined };
}

/** Ordered parts of the system prompt, before the frozen memory snapshot. */
export function buildBaseSystemPrompt(files: AgentFiles): string {
  const parts: string[] = [];
  if (files.soul) parts.push(files.soul.trim());
  if (files.agentsMd) parts.push(files.agentsMd.trim());
  return parts.join("\n\n");
}
