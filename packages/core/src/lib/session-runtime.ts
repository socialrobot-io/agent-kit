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

import { MemoryStore, type MemoryTarget } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import { PendingWriteStore, evaluateGateAsync, skillGist, type ApprovalSubsystem, type GateContext, type WriteOrigin } from "./approval.js";
import type { AgentFsLike, AgentDefinition } from "./agent.js";
import { loadAgentFiles, buildBaseSystemPrompt } from "./agent.js";

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
      name: "memory",
      description: "Save durable facts to persistent memory across sessions.",
      inputSchema: {},
      execute: async (args) => {
        const target = (args.target as MemoryTarget) ?? "memory";
        const summary = (args.content as string)?.slice(0, 60) ?? `memory ${args.action ?? "batch"}`;
        const decision = await evaluateGateAsync("memory", this.gateCtx(), { summary, detail: args.content as string });
        if (decision.kind === "blocked") return { success: false, error: decision.message };
        if (decision.kind === "stage") {
          await this.pending.stage("memory", args, { summary, origin: this.origin });
          return { success: true, staged: true, message: decision.message };
        }
        return this.applyMemory(args, target);
      },
    };
  }

  private async applyMemory(args: Record<string, unknown>, target: MemoryTarget) {
    if (Array.isArray(args.operations)) return this.memory.applyBatch(target, args.operations as never[]);
    const action = args.action as string;
    if (action === "add") return this.memory.add(target, (args.content as string) ?? "");
    if (action === "replace") return this.memory.replace(target, (args.old_text as string) ?? "", (args.content as string) ?? "");
    if (action === "remove") return this.memory.remove(target, (args.old_text as string) ?? "");
    return { success: false, error: `unknown memory action '${action}'` };
  }

  private skillsListTool(): SessionTool {
    return {
      name: "skills_list",
      description: "List available skills (name + description).",
      inputSchema: {},
      execute: async (args) => ({ success: true, skills: await this.skills.list(args.category as string | undefined) }),
    };
  }

  private skillViewTool(): SessionTool {
    return {
      name: "skill_view",
      description: "Load a skill's SKILL.md or a linked reference/template/script file.",
      inputSchema: {},
      execute: async (args) => this.skills.view((args.name as string) ?? "", args.file_path as string | undefined),
    };
  }

  private skillManageTool(): SessionTool {
    return {
      name: "skill_manage",
      description: "Create, update, and delete your own skills (procedural memory).",
      inputSchema: {},
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
            return this.skills.patch(name, (args.old_string as string) ?? "", (args.new_string as string) ?? "", args.file_path as string | undefined, (args.replace_all as boolean) ?? false);
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
