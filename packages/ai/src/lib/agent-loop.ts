/**
 * Thin AI SDK loop: kit owns system prompt + tool composition; every other
 * `generateText` / `streamText` option is typed from the AI SDK and passed through.
 *
 * @see https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text
 * @see https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text
 */

import {
  generateText,
  streamText,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type { AgentSessionRuntime, AgentDefinition, SessionTool } from "@socialrobot-io/agent-kit-core";
import { MEMORY_SCHEMA, SKILL_MANAGE_SCHEMA } from "@socialrobot-io/agent-kit-core";
import { resolveModel, type ResolveModelOptions, type ModelInput } from "./models.js";
import { composeAgentTools } from "./compose-tools.js";

/** Exact AI SDK call parameter objects. */
export type GenerateTextParams = Parameters<typeof generateText>[0];
export type StreamTextParams = Parameters<typeof streamText>[0];

/**
 * Fields the kit fills from the session. Hosts must not set these on the call;
 * they come from `runtime` / composed tools / the `messages` argument.
 */
type KitFilledSdkKeys =
  | "model"
  | "system"
  | "messages"
  | "prompt"
  | "tools"
  | "instructions";

/** Kit-owned fields for one turn (not AI SDK call options). */
export type AgentLoopKitOptions = {
  /** Initialized session runtime (system prompt + builtin tools). */
  runtime: AgentSessionRuntime;
  /** Override the model (else resolved from `definition`). */
  model?: ModelInput;
  /** Used to resolve the model when `model` is omitted. */
  definition?: AgentDefinition;
  /**
   * Extra builtins beyond `runtime.tools()` (e.g. session_search).
   * Prefer `openAgentSession`, which wires this for you.
   */
  builtinTools?: SessionTool[];
  /** Append or replace by name on top of defaults. */
  addTools?: SessionTool[];
  /** Drop tools by name. */
  disableTools?: string[];
  /** Full SessionTool replace (kit). Not the AI SDK `tools` ToolSet. */
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
  /**
   * Full AI SDK ToolSet from `openAgentSession().composeTools().toolSet`.
   * When set, skips internal compose (addTools / disableTools ignored).
   */
  toolSet?: ToolSet;
  /**
   * Convenience for `stopWhen: stepCountIs(n)`.
   * Ignored when `stopWhen` is set. Default 8.
   */
  maxSteps?: number;
};

/** AI SDK `generateText` options the host may set (kit-filled keys omitted). */
export type AgentRunCallOptions = Omit<GenerateTextParams, KitFilledSdkKeys>;

/** AI SDK `streamText` options the host may set (kit-filled keys omitted). */
export type AgentStreamCallOptions = Omit<StreamTextParams, KitFilledSdkKeys>;

/** Options for {@link runAgentTurn}. */
export type AgentRunOptions = AgentLoopKitOptions & ResolveModelOptions & AgentRunCallOptions;

/** Options for {@link streamAgentTurn}. */
export type AgentStreamOptions = AgentLoopKitOptions & ResolveModelOptions & AgentStreamCallOptions;

/**
 * @deprecated Prefer {@link AgentRunOptions} or {@link AgentStreamOptions}.
 * Alias of stream options (the wider AI SDK surface).
 */
export type AgentLoopOptions = AgentStreamOptions;

/** AI SDK result of {@link runAgentTurn}. */
export type AgentLoopResult = Awaited<ReturnType<typeof generateText>>;

/** AI SDK result of {@link streamAgentTurn}. */
export type AgentStreamResult = ReturnType<typeof streamText>;

function peelKitOptions<T extends AgentLoopKitOptions & ResolveModelOptions>(opts: T) {
  const {
    runtime,
    model,
    definition,
    builtinTools,
    addTools,
    disableTools,
    tools,
    addAiTools,
    extraTools,
    extraAiTools,
    toolSet,
    maxSteps,
    gateway,
    apiKey,
    baseURL,
    ...call
  } = opts;

  const kit: AgentLoopKitOptions & ResolveModelOptions = {
    runtime,
    model,
    definition,
    builtinTools,
    addTools,
    disableTools,
    tools,
    addAiTools,
    extraTools,
    extraAiTools,
    toolSet,
    maxSteps,
    gateway,
    apiKey,
    baseURL,
  };

  return { kit, call };
}

function resolveToolSet(kit: AgentLoopKitOptions): ToolSet {
  if (kit.toolSet) return kit.toolSet;
  return composeAgentTools({
    builtins: kit.builtinTools ?? kit.runtime.tools(),
    addTools: kit.addTools,
    disableTools: kit.disableTools,
    tools: kit.tools,
    addAiTools: kit.addAiTools,
    extraTools: kit.extraTools,
    extraAiTools: kit.extraAiTools,
  }).toolSet;
}

function resolveTurnModel(kit: AgentLoopKitOptions & ResolveModelOptions) {
  const modelInput = kit.model ?? kit.definition?.model;
  if (!modelInput) {
    throw new Error("Agent loop needs a model: pass `model` or `definition.model`.");
  }
  return resolveModel(modelInput, {
    gateway: kit.gateway,
    apiKey: kit.apiKey,
    baseURL: kit.baseURL,
  });
}

/**
 * Run one agent turn to completion.
 * Returns the AI SDK `generateText` result unchanged.
 */
export async function runAgentTurn(
  messages: ModelMessage[],
  opts: AgentRunOptions,
): Promise<AgentLoopResult> {
  const { kit, call } = peelKitOptions(opts);
  const { stopWhen, ...sdk } = call;

  return generateText({
    ...sdk,
    model: resolveTurnModel(kit),
    system: kit.runtime.systemPrompt(),
    messages,
    tools: resolveToolSet(kit),
    stopWhen: stopWhen ?? stepCountIs(kit.maxSteps ?? 8),
  });
}

/**
 * Stream one agent turn for AI SDK UI / `useChat`.
 * Returns the AI SDK `streamText` result unchanged.
 */
export function streamAgentTurn(
  messages: ModelMessage[],
  opts: AgentStreamOptions,
): AgentStreamResult {
  const { kit, call } = peelKitOptions(opts);
  const { stopWhen, ...sdk } = call;

  return streamText({
    ...sdk,
    model: resolveTurnModel(kit),
    system: kit.runtime.systemPrompt(),
    messages,
    tools: resolveToolSet(kit),
    stopWhen: stopWhen ?? stepCountIs(kit.maxSteps ?? 8),
  });
}

function toCuratorModelMessages(
  messages: { role: string; content: string }[],
): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === "assistant") return { role: "assistant", content: m.content };
    if (m.role === "system") return { role: "system", content: m.content };
    return { role: "user", content: m.content };
  });
}

function toToolArgs(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
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
      messages: toCuratorModelMessages(input.messages),
      tools: toolSet,
      stopWhen: stepCountIs(4),
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((tc) => ({
        name: tc.toolName,
        args: toToolArgs(tc.input),
      })),
    };
  };
}
