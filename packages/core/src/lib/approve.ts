/**
 * Replay staged memory + skill writes into the live stores, then discard.
 */

import type { MemoryStore } from "./memory.js";
import { applyMemoryArgs } from "./memory.js";
import type { SkillLibrary } from "./skills.js";
import type { PendingWriteStore } from "./approval.js";

export interface ApprovePendingDeps {
  memory: MemoryStore;
  skills: SkillLibrary;
  pending: PendingWriteStore;
}

export type ApplySkillFn = (
  args: Record<string, unknown>,
  deps: { skills: SkillLibrary },
) => Promise<unknown>;

/**
 * Approve every pending memory and skill write.
 * Pass `applySkill` from `@socialrobot-io/agent-kit-curator` (kept there to avoid a core↔curator cycle).
 */
export async function approvePendingWrites(
  deps: ApprovePendingDeps,
  applySkill: ApplySkillFn,
): Promise<string[]> {
  const applied: string[] = [];

  for (const rec of await deps.pending.list("memory")) {
    const result = await applyMemoryArgs(deps.memory, rec.payload);
    if (!result.success) {
      throw new Error(`Failed to apply pending memory ${rec.id}: ${result.error ?? "unknown"}`);
    }
    await deps.pending.discard("memory", rec.id);
    applied.push(`memory:${rec.id} ${rec.summary}`);
  }

  for (const rec of await deps.pending.list("skills")) {
    await applySkill(rec.payload, { skills: deps.skills });
    await deps.pending.discard("skills", rec.id);
    applied.push(`skills:${rec.id} ${rec.summary}`);
  }

  return applied;
}
