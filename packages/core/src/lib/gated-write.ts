/**
 * Single seam for memory/skill writes that go through the approval gate.
 * Session tools, curator, and approve replay all call this module.
 */

import { applyMemoryArgs, type MemoryStore } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import {
  evaluateGateAsync,
  skillGist,
  type GateContext,
  type PendingWriteStore,
  type ApprovalSubsystem,
} from "./approval.js";

export type ApplySkillDeps = { skills: SkillLibrary };

/** Replay a skill_manage payload onto SkillLibrary (approve + curator allow path). */
export async function applySkillArgs(
  args: Record<string, unknown>,
  deps: ApplySkillDeps,
): Promise<unknown> {
  const action = args.action as string;
  const name = (args.name as string) ?? "";
  switch (action) {
    case "create":
      return deps.skills.create(name, (args.content as string) ?? "", args.category as string | undefined);
    case "edit":
      return deps.skills.edit(name, (args.content as string) ?? "");
    case "patch":
      return deps.skills.patch(
        name,
        (args.old_string as string) ?? "",
        (args.new_string as string) ?? "",
        args.file_path as string | undefined,
        (args.replace_all as boolean) ?? false,
      );
    case "delete":
      return deps.skills.deleteSkill(name);
    case "write_file":
      return deps.skills.writeFile(name, (args.file_path as string) ?? "", (args.file_content as string) ?? "");
    case "remove_file":
      return deps.skills.removeFile(name, (args.file_path as string) ?? "");
    default:
      return { success: false, error: `unknown skill action '${action}'` };
  }
}

export function memoryWriteSummary(args: Record<string, unknown>): string {
  if (typeof args.content === "string" && args.content.trim()) {
    const action = (args.action as string) ?? "add";
    return `${action}: ${args.content.slice(0, 60)}`;
  }
  if (Array.isArray(args.operations)) {
    const first = args.operations.find(
      (op): op is { content?: string } =>
        typeof op === "object" && op != null && typeof (op as { content?: string }).content === "string",
    );
    if (first?.content) return `batch: ${first.content.slice(0, 50)}`;
    return `memory batch (${args.operations.length})`;
  }
  return `memory ${(args.action as string) ?? "batch"}`;
}

export type GatedWriteResult =
  | { kind: "blocked"; error: string }
  | { kind: "staged"; id: string; summary: string; message: string }
  | { kind: "applied"; summary: string; result: unknown }
  | { kind: "error"; error: string };

/** Stores required to stage or apply a gated write. */
export interface GatedWriteDeps {
  /** Tenant memory store. */
  memory: MemoryStore;
  /** Tenant skill library (also used for lock checks). */
  skills: SkillLibrary;
  /** Pending-write store for staged proposals. */
  pending: PendingWriteStore;
}

/**
 * Lock-check (skills) → gate → stage or apply.
 * Memory read actions must not call this (handle in the tool).
 *
 * @param subsystem - `memory` or `skills`.
 * @param args - Tool arguments to apply or stage.
 * @param deps - Memory, skills, and pending stores.
 * @param gateCtx - Approval gate configuration for this origin.
 */
export async function submitGatedWrite(
  subsystem: ApprovalSubsystem,
  args: Record<string, unknown>,
  deps: GatedWriteDeps,
  gateCtx: GateContext,
): Promise<GatedWriteResult> {
  if (subsystem === "skills") {
    const name = typeof args.name === "string" ? args.name : "";
    if (name && (await deps.skills.isLocked(name))) {
      return {
        kind: "blocked",
        error: `Skill '${name}' is locked and cannot be modified by the agent.`,
      };
    }
  }

  const summary =
    subsystem === "skills"
      ? skillGist((args.action as string) ?? "", (args.name as string) ?? "", {
          content: args.content as string,
          file_path: args.file_path as string,
          old_string: args.old_string as string,
          new_string: args.new_string as string,
        })
      : memoryWriteSummary(args);

  const detail =
    subsystem === "memory" && typeof args.content === "string" ? args.content : summary;

  const decision = await evaluateGateAsync(subsystem, gateCtx, { summary, detail });
  if (decision.kind === "blocked") {
    return { kind: "blocked", error: decision.message };
  }
  if (decision.kind === "stage") {
    const rec = await deps.pending.stage(subsystem, args, {
      summary,
      origin: gateCtx.origin,
    });
    return {
      kind: "staged",
      id: rec.id,
      summary,
      message: decision.message,
    };
  }

  if (subsystem === "memory") {
    const result = await applyMemoryArgs(deps.memory, args);
    if (!result.success) {
      return { kind: "error", error: result.error ?? "memory apply failed" };
    }
    return { kind: "applied", summary, result };
  }

  const result = await applySkillArgs(args, { skills: deps.skills });
  const asResult = result as { success?: boolean; error?: string };
  if (asResult && asResult.success === false) {
    return { kind: "error", error: asResult.error ?? "skill apply failed" };
  }
  return { kind: "applied", summary, result };
}
