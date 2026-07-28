/**
 * AI SDK `toolApproval` config for agent-kit write tools.
 *
 * Prefer `openAgentSession({ interactiveApproval: true })`: that installs this
 * config on `session.stream` / `session.run` and pairs it with
 * `promptInline: async () => true` so a UI Approve applies the write instead
 * of staging again.
 *
 * Background curator turns should omit interactive approval and keep staging
 * via the pending store.
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
