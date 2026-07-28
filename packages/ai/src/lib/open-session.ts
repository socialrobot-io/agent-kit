/**
 * Batteries-included session open: runtime + default tools + run/stream.
 *
 * Does not open the tenant volume (host does that via openTenantVolume).
 * Pass optional session_search and sandbox tools to include those defaults.
 */

import {
  AgentSessionRuntime,
  type AgentDefinition,
  type AgentFsLike,
  type SessionTool,
  type WriteOrigin,
} from "@socialrobot-io/agent-kit-core";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { composeAgentTools, type ComposeAgentToolsOptions } from "./compose-tools.js";
import {
  runAgentTurn,
  streamAgentTurn,
  type AgentLoopResult,
} from "./agent-loop.js";
import { resolveModel, type ModelInput, type ResolveModelOptions } from "./models.js";

type ComposeOverrides = Omit<ComposeAgentToolsOptions, "builtins" | "extraTools" | "extraAiTools"> & {
  addAiTools?: ToolSet;
};

export type SessionTurnOptions = ComposeOverrides &
  ResolveModelOptions & {
    /** Override the model resolved at open time. */
    model?: ModelInput;
    maxSteps?: number;
    maxRetries?: number;
    onFinish?: (event: { text: string }) => void | Promise<void>;
  };

export interface OpenAgentSessionOptions extends ResolveModelOptions {
  tenantId: string;
  fs: AgentFsLike;
  definition: AgentDefinition;
  /**
   * Live model for this session. Defaults to `definition.model`
   * (string id via AI Gateway, or a ready LanguageModel).
   */
  model?: ModelInput;
  origin?: WriteOrigin;
  /**
   * When provided (e.g. from `createSessionSearchTool`), included in defaults.
   */
  sessionSearchTool?: SessionTool;
  /**
   * When provided (e.g. `createTenantBashToolkit().tools`), merged as AI tools.
   */
  sandboxTools?: ToolSet;
  addTools?: SessionTool[];
  disableTools?: string[];
  /**
   * Interactive approval channel. Pass `async () => true` after the AI SDK UI
   * already approved, so memory/skill writes apply instead of staging again.
   * Omit for background curator turns (staging stays on).
   */
  promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
}

export interface AgentSessionHandle {
  tenantId: string;
  runtime: AgentSessionRuntime;
  definition: AgentDefinition;
  /** Resolved model for this session (override per turn with run/stream options). */
  model: LanguageModel;
  /** Built-in tools (+ session_search if wired). */
  builtinTools: SessionTool[];
  sandboxTools?: ToolSet;
  /**
   * Resolve tools for a turn. Prefer `run` / `stream`, which call this for you.
   */
  composeTools: (overrides?: ComposeOverrides) => ReturnType<typeof composeAgentTools>;
  /** Run one turn to completion. */
  run: (messages: ModelMessage[], opts?: SessionTurnOptions) => Promise<AgentLoopResult>;
  /** Stream one turn (AI SDK UI / useChat). */
  stream: (
    messages: ModelMessage[],
    opts?: SessionTurnOptions,
  ) => ReturnType<typeof streamAgentTurn>;
}

/**
 * init() a runtime and expose default tool composition plus run/stream.
 * Write approval defaults come from `defineAgent` (on by default).
 */
export async function openAgentSession(
  opts: OpenAgentSessionOptions,
): Promise<AgentSessionHandle> {
  const extraToolNames = [
    ...(opts.sessionSearchTool ? [opts.sessionSearchTool.name] : []),
    ...(opts.sandboxTools ? Object.keys(opts.sandboxTools) : []),
  ];

  const runtime = new AgentSessionRuntime({
    tenantId: opts.tenantId,
    fs: opts.fs,
    definition: opts.definition,
    origin: opts.origin ?? "foreground",
    promptInline: opts.promptInline,
    extraToolNames,
  });
  await runtime.init();

  const builtinTools = [
    ...runtime.tools(),
    ...(opts.sessionSearchTool ? [opts.sessionSearchTool] : []),
  ];

  const resolveOpts: ResolveModelOptions = {
    gateway: opts.gateway,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
  };
  const modelInput: ModelInput = opts.model ?? opts.definition.model;
  let cachedModel: LanguageModel | undefined;

  const sessionModel = (): LanguageModel => {
    if (!cachedModel) cachedModel = resolveModel(modelInput, resolveOpts);
    return cachedModel;
  };

  const composeTools = (overrides: ComposeOverrides = {}) =>
    composeAgentTools({
      builtins: builtinTools,
      addTools: [...(opts.addTools ?? []), ...(overrides.addTools ?? [])],
      disableTools: [...(opts.disableTools ?? []), ...(overrides.disableTools ?? [])],
      tools: overrides.tools,
      addAiTools: {
        ...(opts.sandboxTools ?? {}),
        ...(overrides.addAiTools ?? {}),
      },
    });

  const toLoopOpts = (turnOpts: SessionTurnOptions = {}) => {
    const {
      model: modelOverride,
      maxSteps,
      maxRetries,
      onFinish,
      gateway,
      apiKey,
      baseURL,
      ...compose
    } = turnOpts;
    const { toolSet } = composeTools(compose);
    return {
      runtime,
      model: modelOverride
        ? resolveModel(modelOverride, { gateway, apiKey, baseURL, ...resolveOpts })
        : sessionModel(),
      toolSet,
      maxSteps,
      maxRetries,
      onFinish,
    };
  };

  return {
    tenantId: opts.tenantId,
    runtime,
    definition: opts.definition,
    get model() {
      return sessionModel();
    },
    builtinTools,
    sandboxTools: opts.sandboxTools,
    composeTools,
    run: (messages, turnOpts) => runAgentTurn(messages, toLoopOpts(turnOpts)),
    stream: (messages, turnOpts) => streamAgentTurn(messages, toLoopOpts(turnOpts)),
  };
}
