/**
 * Batteries-included session open: runtime + default tool composition.
 *
 * Does not open AgentFS (host does that). Pass optional session_search tool and
 * sandbox AI tools to include those primitives in the default surface.
 */

import {
  AgentSessionRuntime,
  type AgentDefinition,
  type AgentFsLike,
  type SessionTool,
  type WriteOrigin,
} from "@socialrobot-io/agent-kit-core";
import type { ToolSet } from "ai";
import { composeAgentTools, type ComposeAgentToolsOptions } from "./compose-tools.js";

export interface OpenAgentSessionOptions {
  tenantId: string;
  fs: AgentFsLike;
  definition: AgentDefinition;
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
  /** Built-in tools (+ session_search if wired). */
  builtinTools: SessionTool[];
  sandboxTools?: ToolSet;
  /**
   * Resolve tools for a turn. Pass addTools / disableTools / tools / addAiTools
   * to override defaults for that call.
   */
  composeTools: (
    overrides?: Omit<ComposeAgentToolsOptions, "builtins" | "extraTools" | "extraAiTools"> & {
      addAiTools?: ToolSet;
    },
  ) => ReturnType<typeof composeAgentTools>;
}

/**
 * init() a runtime and expose default tool composition.
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

  return {
    tenantId: opts.tenantId,
    runtime,
    builtinTools,
    sandboxTools: opts.sandboxTools,
    composeTools: (overrides = {}) =>
      composeAgentTools({
        builtins: builtinTools,
        addTools: [...(opts.addTools ?? []), ...(overrides.addTools ?? [])],
        disableTools: [...(opts.disableTools ?? []), ...(overrides.disableTools ?? [])],
        tools: overrides.tools,
        addAiTools: {
          ...(opts.sandboxTools ?? {}),
          ...(overrides.addAiTools ?? {}),
        },
      }),
  };
}
