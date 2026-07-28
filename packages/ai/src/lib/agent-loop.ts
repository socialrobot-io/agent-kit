/**
 * A real agent loop over the AI SDK: resolves `defineAgent({ model })`, hands
 * the runtime's frozen system prompt + Hermes tools to `generateText`, and lets
 * the model call tools until it stops (bounded by `stopWhen`).
 *
 * This is the piece that was previously a scripted stub. The memory / skills /
 * approval / sandbox primitives underneath are unchanged — only the model is
 * now live.
 */

import { generateText, stepCountIs, type ModelMessage } from "ai";
import type { AgentSessionRuntime, AgentDefinition, SessionTool } from "@agent-kit/core";
import { resolveModel, type ResolveModelOptions, type ModelInput } from "./models.js";
import { toAiTools } from "./tools.js";

export interface AgentLoopOptions extends ResolveModelOptions {
  runtime: AgentSessionRuntime;
  /** Override the model (else resolved from `definition`). */
  model?: ModelInput;
  definition?: AgentDefinition;
  /** Extra host tools merged over the runtime's Hermes surface. */
  extraTools?: SessionTool[];
  /** Max model steps (tool-call rounds). Default 8. */
  maxSteps?: number;
}

export interface AgentLoopResult {
  text: string;
  steps: number;
  toolCalls: { name: string; args: unknown }[];
  toolResults: unknown[];
}

/**
 * Run one agent turn to completion against a live model.
 */
export async function runAgentTurn(
  messages: ModelMessage[],
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const modelInput = opts.model ?? opts.definition?.model;
  if (!modelInput) {
    throw new Error("runAgentTurn needs a model: pass `model` or `definition.model`.");
  }
  const model = resolveModel(modelInput, opts);
  const tools = toAiTools([...opts.runtime.tools(), ...(opts.extraTools ?? [])]);
  const maxSteps = opts.maxSteps ?? 8;

  const result = await generateText({
    model,
    system: opts.runtime.systemPrompt(),
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
        name: "memory",
        description: "Save a durable fact to persistent memory (target: memory|user).",
        inputSchema: {},
        execute: async () => ({ staged: true }),
      },
      {
        name: "skill_manage",
        description: "Create/update a reusable skill (action, name, content, …).",
        inputSchema: {},
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
        toolCalls.push({ name: tc.toolName, args: ((tc as { input?: unknown }).input ?? {}) as Record<string, unknown> });
      }
    }
    return { text: result.text, toolCalls };
  };
}
