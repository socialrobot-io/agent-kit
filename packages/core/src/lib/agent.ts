/**
 * Agent definition + agent/ directory discovery (Eve-like authoring surface).
 *
 * A project authors an agent as a directory:
 *   agent/
 *     agent.ts          -> defineAgent({ model, ... })
 *     SOUL.md           -> identity (always-on system prompt slot #1)
 *     AGENTS.md         -> persistent context / instructions
 *     skills/           -> on-demand procedures (agentskills.io)
 *     memories/         -> MEMORY.md / USER.md (Hermes curated memory)
 *
 * Custom tools are registered in code (`addTools` / composition helper), not
 * loaded from an `agent/tools/` directory.
 *
 * The runtime loads SOUL.md + AGENTS.md + a frozen MEMORY/USER snapshot into
 * the system prompt, and registers Hermes tools (memory, skills) plus
 * session_search / sandbox when the host wires them via composition.
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
    memoryCharLimit?: number;
    userCharLimit?: number;
    writeApproval?: { memory?: boolean; skills?: boolean };
    sandboxEnabled?: boolean;
  };
}

/** Eve-style `defineAgent`: returns the definition for the runtime to load. */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  if (!def.model) throw new Error("defineAgent requires a model");
  // Secure-by-default: write approval on unless the host explicitly sets flags.
  const writeApproval = def.config?.writeApproval;
  return {
    ...def,
    config: {
      ...def.config,
      writeApproval: {
        memory: writeApproval?.memory ?? true,
        skills: writeApproval?.skills ?? true,
      },
    },
  };
}

export interface AgentFiles {
  soul?: string;
  agentsMd?: string;
}

export interface AgentFsLike extends MemoryFs {
  list(dir: string): Promise<string[]>;
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
