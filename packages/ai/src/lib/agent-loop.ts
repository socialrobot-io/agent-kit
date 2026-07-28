/**
 * A real agent loop over the AI SDK: resolves `defineAgent({ model })`, hands
 * the runtime's frozen system prompt + Hermes tools to `generateText` /
 * `streamText`, and lets the model call tools until it stops (bounded by
 * `stopWhen`).
 *
 * This is the piece that was previously a scripted stub. The memory / skills /
 * approval / sandbox primitives underneath are unchanged — only the model is
 * now live.
 */

import {
  generateText,
  streamText,
  stepCountIs,
  type ModelMessage,
  type StreamTextResult,
  type ToolSet,
} from "ai";
import type { AgentSessionRuntime, AgentDefinition, SessionTool } from "@agent-kit/core";
import { MEMORY_SCHEMA, SKILL_MANAGE_SCHEMA } from "@agent-kit/core";
import { resolveModel, type ResolveModelOptions, type ModelInput } from "./models.js";
import { toAiTools } from "./tools.js";

type AgentStreamResult = StreamTextResult<ToolSet, never, any>;

export interface AgentLoopOptions extends ResolveModelOptions {
  runtime: AgentSessionRuntime;
  /** Override the model (else resolved from `definition`). */
  model?: ModelInput;
  definition?: AgentDefinition;
  /** Extra host tools merged over the runtime's Hermes surface. */
  extraTools?: SessionTool[];
  /** Extra AI SDK tools (e.g. bash-tool) merged into the ToolSet. */
  extraAiTools?: ToolSet;
  /** Max model steps (tool-call rounds). Default 8. */
  maxSteps?: number;
  /** Called when a streamed turn finishes (persist transcripts, curator, …). */
  onFinish?: (event: { text: string }) => void | Promise<void>;
}

export interface AgentLoopResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown }[];
  toolResults: unknown[];
}

function resolveLoopModel(opts: AgentLoopOptions) {
  const modelInput = opts.model ?? opts.definition?.model;
  if (!modelInput) {
    throw new Error("Agent loop needs a model: pass `model` or `definition.model`.");
  }
  return {
    model: resolveModel(modelInput, opts),
    tools: {
      ...toAiTools([...opts.runtime.tools(), ...(opts.extraTools ?? [])]),
      ...(opts.extraAiTools ?? {}),
    },
    maxSteps: opts.maxSteps ?? 8,
    system: opts.runtime.systemPrompt(),
  };
}

/**
 * Run one agent turn to completion against a live model.
 */
export async function runAgentTurn(
  messages: ModelMessage[],
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const { model, tools, maxSteps, system } = resolveLoopModel(opts);

  const result = await generateText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
  });

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
  const { model, tools, maxSteps, system } = resolveLoopModel(opts);
  return streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(maxSteps),
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
    const tools = toAiTools([
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
    ]);

    const result = await generateText({
      model: resolved,
      system: input.systemPrompt,
      messages: input.messages.map((m) => ({
        role: m.role as ModelMessage["role"],
        content: m.content,
      })) as ModelMessage[],
      tools,
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
