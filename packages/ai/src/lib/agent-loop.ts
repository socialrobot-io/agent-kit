/**
 * A real agent loop over the AI SDK: resolves `defineAgent({ model })`, hands
 * the runtime's frozen system prompt + tools to `generateText` / `streamText`,
 * and lets the model call tools until it stops (bounded by `stopWhen`).
 */

import {
  generateText,
  streamText,
  stepCountIs,
  type ModelMessage,
  type StreamTextResult,
  type ToolApprovalConfiguration,
  type ToolSet,
} from "ai";
import type { AgentSessionRuntime, AgentDefinition, SessionTool } from "@socialrobot-io/agent-kit-core";
import { MEMORY_SCHEMA, SKILL_MANAGE_SCHEMA } from "@socialrobot-io/agent-kit-core";
import { resolveModel, type ResolveModelOptions, type ModelInput } from "./models.js";
import { composeAgentTools } from "./compose-tools.js";

type AgentStreamResult = StreamTextResult<ToolSet, never, any>;

export interface AgentLoopOptions extends ResolveModelOptions {
  runtime: AgentSessionRuntime;
  /** Override the model (else resolved from `definition`). */
  model?: ModelInput;
  definition?: AgentDefinition;
  /**
   * Extra builtins beyond `runtime.tools()` (e.g. session_search).
   * Prefer `openAgentSession` which wires this for you.
   */
  builtinTools?: SessionTool[];
  /** Append or replace by name on top of defaults. */
  addTools?: SessionTool[];
  /** Drop tools by name. */
  disableTools?: string[];
  /** Full SessionTool replace. */
  tools?: SessionTool[];
  /** AI SDK tools (bash toolkit, etc.). */
  addAiTools?: ToolSet;
  /**
   * @deprecated Use `addTools`.
   */
  extraTools?: SessionTool[];
  /**
   * @deprecated Use `addAiTools`.
   */
  extraAiTools?: ToolSet;
  /** Max model steps (tool-call rounds). Default 8. */
  maxSteps?: number;
  /**
   * Full AI SDK ToolSet from `openAgentSession().composeTools().toolSet`.
   * When set, skips internal compose (addTools / disableTools ignored).
   */
  toolSet?: ToolSet;
  /**
   * AI SDK UI approval gate for write tools. Prefer
   * `openAgentSession({ interactiveApproval: true })`, which sets this and
   * pairs it with `promptInline`.
   */
  toolApproval?: ToolApprovalConfiguration<ToolSet, unknown>;
  /** Called when a streamed turn finishes (persist transcripts, curator, …). */
  onFinish?: (event: { text: string }) => void | Promise<void>;
  /** Retry transient provider failures. Default 2 retries. */
  maxRetries?: number;
}

export interface AgentLoopResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown }[];
  toolResults: unknown[];
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|timeout|429|503|ECONNRESET|ETIMEDOUT|temporarily/i.test(msg);
}

async function withRetries<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientError(err) || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function resolveLoopModel(opts: AgentLoopOptions) {
  const modelInput = opts.model ?? opts.definition?.model;
  if (!modelInput) {
    throw new Error("Agent loop needs a model: pass `model` or `definition.model`.");
  }
  const tools =
    opts.toolSet ??
    composeAgentTools({
      builtins: opts.builtinTools ?? opts.runtime.tools(),
      addTools: opts.addTools,
      disableTools: opts.disableTools,
      tools: opts.tools,
      addAiTools: opts.addAiTools,
      extraTools: opts.extraTools,
      extraAiTools: opts.extraAiTools,
    }).toolSet;
  return {
    model: resolveModel(modelInput, opts),
    tools,
    maxSteps: opts.maxSteps ?? 8,
    system: opts.runtime.systemPrompt(),
    maxRetries: opts.maxRetries ?? 2,
    toolApproval: opts.toolApproval,
  };
}

/**
 * Run one agent turn to completion against a live model.
 */
export async function runAgentTurn(
  messages: ModelMessage[],
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const { model, tools, maxSteps, system, maxRetries, toolApproval } = resolveLoopModel(opts);

  const result = await withRetries(
    () =>
      generateText({
        model,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(maxSteps),
        ...(toolApproval ? { toolApproval } : {}),
      }),
    maxRetries,
  );

  const toolCalls: { name: string; args: unknown }[] = [];
  const toolResults: unknown[] = [];
  for (const step of result.steps) {
    for (const tc of step.toolCalls ?? []) {
      toolCalls.push({ name: tc.toolName, args: (tc as { input?: unknown }).input });
    }
    for (const tr of step.toolResults ?? []) {
      toolResults.push((tr as { output?: unknown }).output ?? tr);
    }
  }

  return {
    text: result.text,
    steps: result.steps.length,
    toolCalls,
    toolResults,
  };
}

/**
 * Stream one agent turn (tools + text) for AI SDK UI / `useChat`.
 */
export function streamAgentTurn(
  messages: ModelMessage[],
  opts: AgentLoopOptions,
): AgentStreamResult {
  const { model, tools, maxSteps, system, toolApproval } = resolveLoopModel(opts);
  return streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(toolApproval ? { toolApproval } : {}),
    onFinish: opts.onFinish
      ? async ({ text }) => {
          await opts.onFinish?.({ text });
        }
      : undefined,
  }) as AgentStreamResult;
}

/**
 * Adapt a `CuratorModelRunner` (the seam the curator package expects) onto a
 * live model. Returns a runner that asks the model which memory/skill_manage
 * calls to make for a review pass.
 */
export function aiCuratorRunner(model: ModelInput, opts: ResolveModelOptions = {}) {
  return async (input: {
    systemPrompt: string;
    messages: { role: string; content: string }[];
  }): Promise<{ text: string; toolCalls: { name: string; args: Record<string, unknown> }[] }> => {
    const resolved = resolveModel(model, opts);
    const { toolSet } = composeAgentTools({
      builtins: [
        {
          name: MEMORY_SCHEMA.name,
          description: MEMORY_SCHEMA.description,
          inputSchema: { ...MEMORY_SCHEMA.inputSchema },
          execute: async () => ({ staged: true }),
        },
        {
          name: SKILL_MANAGE_SCHEMA.name,
          description: SKILL_MANAGE_SCHEMA.description,
          inputSchema: { ...SKILL_MANAGE_SCHEMA.inputSchema },
          execute: async () => ({ staged: true }),
        },
      ],
    });

    const result = await generateText({
      model: resolved,
      system: input.systemPrompt,
      messages: input.messages.map((m) => ({
        role: m.role as ModelMessage["role"],
        content: m.content,
      })) as ModelMessage[],
      tools: toolSet,
      stopWhen: stepCountIs(4),
    });

    const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
    for (const step of result.steps) {
      for (const tc of step.toolCalls ?? []) {
        toolCalls.push({
          name: tc.toolName,
          args: ((tc as { input?: unknown }).input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return { text: result.text, toolCalls };
  };
}
