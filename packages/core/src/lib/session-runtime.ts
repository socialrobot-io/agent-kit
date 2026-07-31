/**
 * Session runtime: assembles the system prompt (SOUL + AGENTS.md + frozen
 * MEMORY/USER snapshot) and the built-in tool surface, ready to hand to a
 * Vercel AI SDK `streamText`/`generate` call or any other model loop.
 *
 * This is the composition root for a single tenant session. It owns a
 * MemoryStore, a SkillLibrary, and a PendingWriteStore bound to the tenant's
 * agent-home filesystem, and produces tools whose handlers route memory/skill
 * writes through the write-approval gate.
 */

import { MemoryStore, applyMemoryArgs } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import {
  PendingWriteStore,
  type ApprovalSubsystem,
  type GateContext,
  type WriteOrigin,
} from "./approval.js";
import type { AgentFsLike, AgentDefinition } from "./agent.js";
import { loadAgentFiles, buildBaseSystemPrompt } from "./agent.js";
import {
  MEMORY_SCHEMA,
  SKILLS_LIST_SCHEMA,
  SKILL_VIEW_SCHEMA,
  SKILL_MANAGE_SCHEMA,
} from "./schemas.js";
import { buildToolGuidance, type ToolGuidanceConfig } from "./tool-guidance.js";
import { submitGatedWrite } from "./gated-write.js";

/** One model tool call (name + JSON-shaped args). */
export interface SessionToolCall {
  /** Tool name as registered on the session surface. */
  name: string;
  /** Arguments object passed to {@link SessionTool.execute}. */
  args: Record<string, unknown>;
}

/** Host-agnostic tool shape used by the session runtime and AI adapters. */
export interface SessionTool {
  /** Stable tool name (e.g. `memory`, `skill_manage`). */
  name: string;
  /** Description shown to the model. */
  description: string;
  /** JSON Schema for tool arguments. */
  inputSchema: Record<string, unknown>;
  /** Run the tool. Returns a JSON-serializable result for the model. */
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** Options for {@link AgentSessionRuntime}. */
export interface SessionRuntimeOptions {
  /** Stable tenant id for this session. */
  tenantId: string;
  /** Agent-home filesystem (volume or policy-wrapped FS). */
  fs: AgentFsLike;
  /** Optional definition for char limits, write-approval flags, tool guidance. */
  definition?: AgentDefinition;
  /** Directory of SOUL.md / AGENTS.md on the volume. Default `agent`. */
  agentDir?: string;
  /**
   * Write origin for the approval gate. Default `"foreground"`.
   * Background curator passes `"background_review"`.
   */
  origin?: WriteOrigin;
  /**
   * Whether the write-approval gate is on for a subsystem.
   * Default: read from `definition.config.writeApproval`.
   */
  writeApprovalEnabled?: (subsystem: ApprovalSubsystem) => boolean;
  /**
   * Interactive approve channel. Return `true` to apply now, `false` to
   * reject, `null` to stage under `pending/`.
   */
  promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
  /**
   * Extra tool names on the session surface (e.g. session_search, bash) used
   * only for pairing system-prompt guidance.
   */
  extraToolNames?: string[];
  /** Host secrets scrubbed before memory/skill writes. */
  secrets?: string[];
}

export class AgentSessionRuntime {
  /** Stable tenant id for this session. */
  readonly tenantId: string;
  /** Curated MEMORY.md / USER.md store. */
  readonly memory: MemoryStore;
  /** Skill library bound to the agent-home filesystem. */
  readonly skills: SkillLibrary;
  /** Staged writes waiting for human approval. */
  readonly pending: PendingWriteStore;
  private readonly origin: WriteOrigin;
  private readonly writeApprovalEnabled: (s: ApprovalSubsystem) => boolean;
  private readonly promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
  private readonly extraToolNames: string[];
  private readonly toolGuidance: ToolGuidanceConfig;
  private basePrompt = "";
  private ready = false;

  constructor(private readonly opts: SessionRuntimeOptions) {
    this.tenantId = opts.tenantId;
    const secrets = opts.secrets ?? [];
    this.memory = new MemoryStore(opts.fs, {
      memoryCharLimit: opts.definition?.config?.memoryCharLimit,
      userCharLimit: opts.definition?.config?.userCharLimit,
      secrets,
    });
    this.skills = new SkillLibrary(opts.fs, "", { secrets });
    this.pending = new PendingWriteStore(opts.fs);
    this.origin = opts.origin ?? "foreground";
    const cfg = opts.definition?.config?.writeApproval;
    this.writeApprovalEnabled =
      opts.writeApprovalEnabled ?? ((s) => (s === "memory" ? !!cfg?.memory : !!cfg?.skills));
    this.promptInline = opts.promptInline;
    this.extraToolNames = opts.extraToolNames ?? [];
    this.toolGuidance = opts.definition?.config?.toolGuidance ?? true;
  }

  private gateCtx(): GateContext {
    return { writeApprovalEnabled: this.writeApprovalEnabled, origin: this.origin, promptInline: this.promptInline };
  }

  /** Load agent files + memory, then build the frozen system prompt. */
  async init(): Promise<void> {
    const files = await loadAgentFiles(this.opts.fs, this.opts.agentDir ?? "agent");
    this.basePrompt = buildBaseSystemPrompt(files);
    await this.memory.loadFromDisk();
    this.ready = true;
  }

  /**
   * Rebuild the memory snapshot from disk without reloading SOUL/AGENTS.
   * Use between HTTP requests when the runtime is process-scoped.
   */
  async refreshMemory(): Promise<void> {
    if (!this.ready) throw new Error("call init() first");
    await this.memory.refreshSnapshot();
  }

  /**
   * Reload SOUL/AGENTS + memory snapshot from the agent home.
   * Needed when seed files change under a long-lived process singleton.
   */
  async reload(): Promise<void> {
    const files = await loadAgentFiles(this.opts.fs, this.opts.agentDir ?? "agent");
    this.basePrompt = buildBaseSystemPrompt(files);
    await this.memory.refreshSnapshot();
    this.ready = true;
  }

  /** The frozen system prompt for this session (base + memory snapshot + tool guidance). */
  systemPrompt(): string {
    if (!this.ready) throw new Error("call init() first");
    const mem = this.memory.formatAllForSystemPrompt();
    const toolNames = [...this.tools().map((t) => t.name), ...this.extraToolNames];
    const guidance = buildToolGuidance(toolNames, this.toolGuidance);
    return [this.basePrompt, mem, guidance].filter(Boolean).join("\n\n");
  }

  /** Built-in tool surface for the model loop. */
  tools(): SessionTool[] {
    return [this.memoryTool(), this.skillsListTool(), this.skillViewTool(), this.skillManageTool()];
  }

  private gatedDeps() {
    return { memory: this.memory, skills: this.skills, pending: this.pending };
  }

  private memoryTool(): SessionTool {
    return {
      name: MEMORY_SCHEMA.name,
      description: MEMORY_SCHEMA.description,
      inputSchema: { ...MEMORY_SCHEMA.inputSchema },
      execute: async (args) => {
        const action = args.action as string | undefined;
        // Reads never go through write-approval.
        if (action === "list" || action === "get" || action === "read") {
          return applyMemoryArgs(this.memory, args);
        }
        const outcome = await submitGatedWrite("memory", args, this.gatedDeps(), this.gateCtx());
        if (outcome.kind === "blocked" || outcome.kind === "error") {
          return { success: false, error: outcome.error };
        }
        if (outcome.kind === "staged") {
          return { success: true, staged: true, message: outcome.message };
        }
        return outcome.result;
      },
    };
  }

  private skillsListTool(): SessionTool {
    return {
      name: SKILLS_LIST_SCHEMA.name,
      description: SKILLS_LIST_SCHEMA.description,
      inputSchema: { ...SKILLS_LIST_SCHEMA.inputSchema },
      execute: async (args) => ({
        success: true,
        skills: await this.skills.list(args.category as string | undefined),
      }),
    };
  }

  private skillViewTool(): SessionTool {
    return {
      name: SKILL_VIEW_SCHEMA.name,
      description: SKILL_VIEW_SCHEMA.description,
      inputSchema: { ...SKILL_VIEW_SCHEMA.inputSchema },
      execute: async (args) =>
        this.skills.view((args.name as string) ?? "", args.file_path as string | undefined),
    };
  }

  private skillManageTool(): SessionTool {
    return {
      name: SKILL_MANAGE_SCHEMA.name,
      description: SKILL_MANAGE_SCHEMA.description,
      inputSchema: { ...SKILL_MANAGE_SCHEMA.inputSchema },
      execute: async (args) => {
        const outcome = await submitGatedWrite("skills", args, this.gatedDeps(), this.gateCtx());
        if (outcome.kind === "blocked" || outcome.kind === "error") {
          return { success: false, error: outcome.error };
        }
        if (outcome.kind === "staged") {
          return { success: true, staged: true, message: outcome.message };
        }
        return outcome.result;
      },
    };
  }
}
