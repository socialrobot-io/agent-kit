/**
 * Batteries-included session open: runtime + default tools + run/stream.
 *
 * Does not open the tenant volume (host does that via openTenantVolume or
 * createTenantHome). Pass optional session_search and sandbox tools to include
 * those defaults.
 */

import {
  AgentSessionRuntime,
  type AgentDefinition,
  type AgentFsLike,
  type MemoryStore,
  type PendingWriteStore,
  type SessionTool,
  type SkillLibrary,
  type WriteOrigin,
} from "@socialrobot-io/agent-kit-core";
import type { LanguageModel, ModelMessage, ToolApprovalConfiguration, ToolSet } from "ai";
import { composeAgentTools, type ComposeAgentToolsOptions } from "./compose-tools.js";
import {
  runAgentTurn,
  streamAgentTurn,
  type AgentLoopResult,
  type AgentRunOptions,
  type AgentStreamOptions,
  type AgentStreamResult,
} from "./agent-loop.js";
import { resolveModel, type ModelInput, type ResolveModelOptions } from "./models.js";
import {
  createWriteToolApproval,
  type WriteToolApprovalOptions,
} from "./write-tool-approval.js";

type ComposeOverrides = Omit<ComposeAgentToolsOptions, "builtins" | "extraTools" | "extraAiTools"> & {
  addAiTools?: ToolSet;
};

/** Bound by {@link openAgentSession}; not set again on each turn. */
type SessionBoundKitKeys =
  | "runtime"
  | "definition"
  | "builtinTools"
  | "toolSet"
  | "extraTools"
  | "extraAiTools";

/**
 * Per-turn options for {@link AgentSession.run}.
 * AI SDK `generateText` options (minus kit-filled keys) plus tool compose knobs.
 */
export type SessionRunOptions = Omit<AgentRunOptions, SessionBoundKitKeys>;

/**
 * Per-turn options for {@link AgentSession.stream}.
 * AI SDK `streamText` options (minus kit-filled keys) plus tool compose knobs.
 */
export type SessionStreamOptions = Omit<AgentStreamOptions, SessionBoundKitKeys>;

/**
 * @deprecated Prefer {@link SessionRunOptions} / {@link SessionStreamOptions}.
 * Alias of stream options (wider AI SDK surface).
 */
export type SessionTurnOptions = SessionStreamOptions;

/** Options for {@link openAgentSession}. */
export interface OpenAgentSessionOptions extends ResolveModelOptions {
  /** Stable tenant id. Must match the volume / transcript ownership. */
  tenantId: string;
  /** Agent-home filesystem (volume or policy-wrapped FS). */
  fs: AgentFsLike;
  /** Agent definition (`defineAgent`). Supplies model defaults and write-approval flags. */
  definition: AgentDefinition;
  /**
   * Live model for this session. Defaults to `definition.model`
   * (string id via AI Gateway, or a ready LanguageModel).
   */
  model?: ModelInput;
  /**
   * Write origin for the approval gate. Default `"foreground"`.
   * Use `"background_review"` for curator turns.
   */
  origin?: WriteOrigin;
  /**
   * When provided (e.g. from `createSessionSearchTool`), included in defaults.
   */
  sessionSearchTool?: SessionTool;
  /**
   * When provided (e.g. `createTenantBashToolkit().tools`), merged as AI tools.
   */
  sandboxTools?: ToolSet;
  /** Extra SessionTools merged into the default surface for every turn. */
  addTools?: SessionTool[];
  /** Tool names to remove from the default surface for every turn. */
  disableTools?: string[];
  /**
   * Pair AI SDK UI Approve/Deny with kit write application.
   * Sets `promptInline: async () => true` (unless you pass `promptInline`) and
   * attaches `createWriteToolApproval` to `session.run` / `session.stream`.
   * Pass `true` for both memory and skills, or a subset via options.
   */
  interactiveApproval?: boolean | WriteToolApprovalOptions;
  /**
   * Interactive approval channel. Prefer `interactiveApproval` unless you need
   * a custom prompt. Omit for background curator turns (staging stays on).
   */
  promptInline?: (summary: string, detail: string) => Promise<boolean | null>;
  /** Host secrets scrubbed before memory/skill writes (and paired with sandbox). */
  secrets?: string[];
}

/**
 * Open agent bound to one chat. Prefer `createTenantHome().openSession` for
 * the full host stack.
 */
export interface AgentSession {
  /** Tenant this session belongs to. */
  tenantId: string;
  /** Advanced: core engine. Prefer `memory` / `skills` / `pending` / `run`. */
  runtime: AgentSessionRuntime;
  /** Definition used when this session was opened. */
  definition: AgentDefinition;
  /** Resolved model for this session (override per turn with run/stream options). */
  model: LanguageModel;
  /** Curated MEMORY.md / USER.md store for this tenant. */
  memory: MemoryStore;
  /** Skill library bound to the tenant volume. */
  skills: SkillLibrary;
  /** Staged writes waiting for human approval. */
  pending: PendingWriteStore;
  /** Built-in tools (+ session_search if wired). */
  builtinTools: SessionTool[];
  /** Sandbox AI tools passed at open time (`bash`, `readFile`, …). */
  sandboxTools?: ToolSet;
  /**
   * AI SDK `toolApproval` when `interactiveApproval` was enabled.
   * Also applied automatically by `run` / `stream`.
   */
  writeToolApproval?: ToolApprovalConfiguration<ToolSet, unknown>;
  /**
   * Resolve tools for a turn. Prefer `run` / `stream`, which call this for you.
   */
  composeTools: (overrides?: ComposeOverrides) => ReturnType<typeof composeAgentTools>;
  /** Run one turn to completion. Returns the AI SDK `generateText` result. */
  run: (messages: ModelMessage[], opts?: SessionRunOptions) => Promise<AgentLoopResult>;
  /** Stream one turn (AI SDK UI / useChat). Returns the AI SDK `streamText` result. */
  stream: (messages: ModelMessage[], opts?: SessionStreamOptions) => AgentStreamResult;
}

/**
 * init() a runtime and expose default tool composition plus run/stream.
 * Write approval defaults come from `defineAgent` (on by default).
 *
 * @param opts - Tenant FS, definition, model, and optional tool wiring.
 * @returns Session handle with `run` / `stream` and store accessors.
 */
export async function openAgentSession(
  opts: OpenAgentSessionOptions,
): Promise<AgentSession> {
  const extraToolNames = [
    ...(opts.sessionSearchTool ? [opts.sessionSearchTool.name] : []),
    ...(opts.sandboxTools ? Object.keys(opts.sandboxTools) : []),
  ];

  const interactive =
    opts.interactiveApproval === true
      ? {}
      : typeof opts.interactiveApproval === "object"
        ? opts.interactiveApproval
        : undefined;
  const writeToolApproval =
    interactive !== undefined ? createWriteToolApproval(interactive) : undefined;
  const promptInline =
    opts.promptInline ??
    (interactive !== undefined ? async () => true : undefined);

  const runtime = new AgentSessionRuntime({
    tenantId: opts.tenantId,
    fs: opts.fs,
    definition: opts.definition,
    origin: opts.origin ?? "foreground",
    promptInline,
    extraToolNames,
    secrets: opts.secrets,
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

  const bindRun = (turnOpts: SessionRunOptions = {}): AgentRunOptions => {
    const {
      model: modelOverride,
      maxSteps,
      gateway,
      apiKey,
      baseURL,
      addTools,
      disableTools,
      tools,
      addAiTools,
      toolApproval,
      ...call
    } = turnOpts;

    const { toolSet } = composeTools({
      addTools,
      disableTools,
      tools,
      addAiTools,
    });

    return {
      runtime,
      model: modelOverride
        ? resolveModel(modelOverride, { gateway, apiKey, baseURL, ...resolveOpts })
        : sessionModel(),
      toolSet,
      maxSteps,
      ...call,
      toolApproval: toolApproval ?? writeToolApproval,
    };
  };

  const bindStream = (turnOpts: SessionStreamOptions = {}): AgentStreamOptions => {
    const {
      model: modelOverride,
      maxSteps,
      gateway,
      apiKey,
      baseURL,
      addTools,
      disableTools,
      tools,
      addAiTools,
      toolApproval,
      ...call
    } = turnOpts;

    const { toolSet } = composeTools({
      addTools,
      disableTools,
      tools,
      addAiTools,
    });

    return {
      runtime,
      model: modelOverride
        ? resolveModel(modelOverride, { gateway, apiKey, baseURL, ...resolveOpts })
        : sessionModel(),
      toolSet,
      maxSteps,
      ...call,
      toolApproval: toolApproval ?? writeToolApproval,
    };
  };

  return {
    tenantId: opts.tenantId,
    runtime,
    definition: opts.definition,
    get model() {
      return sessionModel();
    },
    get memory() {
      return runtime.memory;
    },
    get skills() {
      return runtime.skills;
    },
    get pending() {
      return runtime.pending;
    },
    builtinTools,
    sandboxTools: opts.sandboxTools,
    writeToolApproval,
    composeTools,
    run: (messages, turnOpts) => runAgentTurn(messages, bindRun(turnOpts)),
    stream: (messages, turnOpts) => streamAgentTurn(messages, bindStream(turnOpts)),
  };
}
