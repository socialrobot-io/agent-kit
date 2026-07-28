/**
 * AI SDK `toolApproval` config for agent-kit write tools.
 *
 * Interactive hosts should pass this to `streamText` / `streamAgentTurn` and
 * render Approve/Deny in the UI via `addToolApprovalResponse`. Pair with
 * `promptInline: async () => true` on the runtime so that once the user
 * approves in the UI, the write actually applies (instead of staging again).
 *
 * Background curator turns should omit toolApproval and keep staging via the
 * pending store.
 */

import type { ToolApprovalConfiguration, ToolSet } from "ai";

export interface WriteToolApprovalOptions {
  /** Require UI approval for mutating `memory` calls. Default true. */
  memory?: boolean;
  /** Require UI approval for `skill_manage`. Default true. */
  skills?: boolean;
}

function isMemoryRead(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const action = (input as { action?: unknown }).action;
  return action === "list" || action === "get" || action === "read";
}

/**
 * Build a `toolApproval` map for streamText / generateText.
 * Returns undefined when both gates are off (caller can omit the option).
 */
export function createWriteToolApproval(
  opts: WriteToolApprovalOptions = {},
): ToolApprovalConfiguration<ToolSet, unknown> | undefined {
  const memory = opts.memory !== false;
  const skills = opts.skills !== false;
  if (!memory && !skills) return undefined;

  const config: ToolApprovalConfiguration<ToolSet, unknown> = {};
  if (memory) {
    config.memory = async (input) =>
      isMemoryRead(input) ? "not-applicable" : "user-approval";
  }
  if (skills) {
    config.skill_manage = "user-approval";
  }
  return config;
}
