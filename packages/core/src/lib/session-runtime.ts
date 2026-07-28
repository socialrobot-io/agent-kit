/**
 * Session runtime: assembles the system prompt (SOUL + AGENTS.md + frozen
 * MEMORY/USER snapshot) and the Hermes tool surface, ready to hand to a Vercel
 * AI SDK `streamText`/`generate` call or any other model loop.
 *
 * This is the composition root for a single tenant session. It owns a
 * MemoryStore, a SkillLibrary, and a PendingWriteStore bound to the tenant's
 * agent-home filesystem, and produces tools whose handlers route memory/skill
 * writes through the write-approval gate.
 */

import { MemoryStore, applyMemoryArgs } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import { PendingWriteStore, evaluateGateAsync, skillGist, type ApprovalSubsystem, type GateContext, type WriteOrigin } from "./approval.js";
import type { AgentFsLike, AgentDefinition } from "./agent.js";
import { loadAgentFiles, buildBaseSystemPrompt } from "./agent.js";
import {
  MEMORY_SCHEMA,
  SKILLS_LIST_SCHEMA,
  SKILL_VIEW_SCHEMA,
  SKILL_MANAGE_SCHEMA,
} from "./schemas.js";

export interface SessionToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface SessionTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface SessionRuntimeOptions {
  tenantId: string;
  fs: AgentFsLike;
  definition?: AgentDefinition;
  agentDir?: string;
  origin?: WriteOrigin;
  writeApprovalEnabled?: (subsystem: ApprovalSubsystem) => boolean;
  promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
}

export class AgentSessionRuntime {
  readonly tenantId: string;
  readonly memory: MemoryStore;
  readonly skills: SkillLibrary;
  readonly pending: PendingWriteStore;
  private readonly origin: WriteOrigin;
  private readonly writeApprovalEnabled: (s: ApprovalSubsystem) => boolean;
  private readonly promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
  private basePrompt = "";
  private ready = false;

  constructor(private readonly opts: SessionRuntimeOptions) {
    this.tenantId = opts.tenantId;
    this.memory = new MemoryStore(opts.fs, {
      memoryCharLimit: opts.definition?.config?.memoryCharLimit,
      userCharLimit: opts.definition?.config?.userCharLimit,
    });
    this.skills = new SkillLibrary(opts.fs);
    this.pending = new PendingWriteStore(opts.fs);
    this.origin = opts.origin ?? "foreground";
    const cfg = opts.definition?.config?.writeApproval;
    this.writeApprovalEnabled =
      opts.writeApprovalEnabled ?? ((s) => (s === "memory" ? !!cfg?.memory : !!cfg?.skills));
    this.promptInline = opts.promptInline;
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

  /** The frozen system prompt for this session (base + memory snapshot). */
  systemPrompt(): string {
    if (!this.ready) throw new Error("call init() first");
    const mem = this.memory.formatAllForSystemPrompt();
    return [this.basePrompt, mem].filter(Boolean).join("\n\n");
  }

  /** Hermes tool surface for the model loop. */
  tools(): SessionTool[] {
    return [this.memoryTool(), this.skillsListTool(), this.skillViewTool(), this.skillManageTool()];
  }

  private memoryTool(): SessionTool {
    return {
      name: MEMORY_SCHEMA.name,
      description: MEMORY_SCHEMA.description,
      inputSchema: { ...MEMORY_SCHEMA.inputSchema },
      execute: async (args) => {
        const summary = memoryToolSummary(args);
        const decision = await evaluateGateAsync("memory", this.gateCtx(), {
          summary,
          detail: (args.content as string) ?? summary,
        });
        if (decision.kind === "blocked") return { success: false, error: decision.message };
        if (decision.kind === "stage") {
          await this.pending.stage("memory", args, { summary, origin: this.origin });
          return { success: true, staged: true, message: decision.message };
        }
        return applyMemoryArgs(this.memory, args);
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
        const action = (args.action as string) ?? "";
        const name = (args.name as string) ?? "";
        const summary = skillGist(action, name, {
          content: args.content as string,
          file_path: args.file_path as string,
          old_string: args.old_string as string,
          new_string: args.new_string as string,
        });
        const decision = await evaluateGateAsync("skills", this.gateCtx(), { summary });
        if (decision.kind === "blocked") return { success: false, error: decision.message };
        if (decision.kind === "stage") {
          await this.pending.stage("skills", args, { summary, origin: this.origin });
          return { success: true, staged: true, message: decision.message };
        }
        switch (action) {
          case "create":
            return this.skills.create(name, (args.content as string) ?? "", args.category as string | undefined);
          case "edit":
            return this.skills.edit(name, (args.content as string) ?? "");
          case "patch":
            return this.skills.patch(
              name,
              (args.old_string as string) ?? "",
              (args.new_string as string) ?? "",
              args.file_path as string | undefined,
              (args.replace_all as boolean) ?? false,
            );
          case "delete":
            return this.skills.deleteSkill(name);
          case "write_file":
            return this.skills.writeFile(name, (args.file_path as string) ?? "", (args.file_content as string) ?? "");
          case "remove_file":
            return this.skills.removeFile(name, (args.file_path as string) ?? "");
          default:
            return { success: false, error: `unknown skill action '${action}'` };
        }
      },
    };
  }
}

function memoryToolSummary(args: Record<string, unknown>): string {
  if (typeof args.content === "string" && args.content.trim()) {
    return args.content.slice(0, 60);
  }
  if (Array.isArray(args.operations)) {
    const first = args.operations.find(
      (op): op is { content?: string } =>
        typeof op === "object" && op != null && typeof (op as { content?: string }).content === "string",
    );
    if (first?.content) return `batch: ${first.content.slice(0, 50)}`;
    return `memory batch (${args.operations.length})`;
  }
  return `memory ${String(args.action ?? "batch")}`;
}
