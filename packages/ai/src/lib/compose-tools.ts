/**
 * Compose the default agent tool surface with clear overrides.
 *
 * Prefer this over assembling `extraTools` / `extraAiTools` by hand.
 */

import type { ToolSet } from "ai";
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import { toAiTools } from "./tools.js";

export interface ComposeAgentToolsOptions {
  /** Built-in SessionTools (runtime tools + optional session_search). */
  builtins: SessionTool[];
  /** Append or replace by name. */
  addTools?: SessionTool[];
  /** Drop tools by name (builtins and adds). */
  disableTools?: string[];
  /** Full replace of SessionTools (ignores builtins / add / disable). */
  tools?: SessionTool[];
  /** AI SDK tools (e.g. bash toolkit). Merged after SessionTools. */
  addAiTools?: ToolSet;
  /**
   * @deprecated Use `addTools`.
   */
  extraTools?: SessionTool[];
  /**
   * @deprecated Use `addAiTools`.
   */
  extraAiTools?: ToolSet;
}

export interface ComposedAgentTools {
  sessionTools: SessionTool[];
  /** Ready for generateText / streamText. */
  toolSet: ToolSet;
}

/**
 * Build the tool list for one turn.
 *
 * Precedence: `tools` (full replace) else builtins + addTools - disableTools,
 * then merge addAiTools into the AI SDK ToolSet.
 */
export function composeAgentTools(opts: ComposeAgentToolsOptions): ComposedAgentTools {
  const addTools = opts.addTools ?? opts.extraTools ?? [];
  const addAiTools = opts.addAiTools ?? opts.extraAiTools ?? {};
  const disabled = new Set(opts.disableTools ?? []);

  let sessionTools: SessionTool[];
  if (opts.tools) {
    sessionTools = opts.tools.filter((t) => !disabled.has(t.name));
  } else {
    const byName = new Map<string, SessionTool>();
    for (const t of opts.builtins) byName.set(t.name, t);
    for (const t of addTools) byName.set(t.name, t);
    sessionTools = [...byName.values()].filter((t) => !disabled.has(t.name));
  }

  return {
    sessionTools,
    toolSet: {
      ...toAiTools(sessionTools),
      ...addAiTools,
    },
  };
}
