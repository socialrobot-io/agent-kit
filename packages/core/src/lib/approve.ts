/**
 * Replay staged memory + skill writes into the live stores, then discard.
 */

import type { MemoryStore } from "./memory.js";
import { applyMemoryArgs } from "./memory.js";
import type { SkillLibrary } from "./skills.js";
import type { PendingWriteStore } from "./approval.js";
import { applySkillArgs } from "./gated-write.js";

/** Stores required to apply staged pending writes. */
export interface ApprovePendingDeps {
  /** Tenant memory store that receives approved memory writes. */
  memory: MemoryStore;
  /** Tenant skill library that receives approved skill writes. */
  skills: SkillLibrary;
  /** Pending-write store to list and discard records. */
  pending: PendingWriteStore;
}

/**
 * Approve every pending memory and skill write.
 * Skill replay uses {@link applySkillArgs} in core (no curator injection).
 *
 * @param deps - Memory, skills, and pending stores for one tenant.
 * @returns Human-readable lines describing each applied write.
 */
export async function approvePendingWrites(deps: ApprovePendingDeps): Promise<string[]> {
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
    const name = typeof rec.payload.name === "string" ? rec.payload.name : undefined;
    if (name && (await deps.skills.isLocked(name))) {
      throw new Error(
        `Failed to apply pending skill ${rec.id}: Skill '${name}' is locked and cannot be modified by the agent.`,
      );
    }
    const result = (await applySkillArgs(rec.payload, { skills: deps.skills })) as {
      success?: boolean;
      error?: string;
    };
    if (result && result.success === false) {
      throw new Error(`Failed to apply pending skill ${rec.id}: ${result.error ?? "unknown"}`);
    }
    await deps.pending.discard("skills", rec.id);
    applied.push(`skills:${rec.id} ${rec.summary}`);
  }

  return applied;
}
