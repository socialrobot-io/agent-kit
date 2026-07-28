/**
 * Background self-improvement review (the "curator").
 *
 * TypeScript port of Nous Research Hermes Agent `agent/background_review.py`
 * prompts and runner contract (MIT).
 *
 * After a turn, a forked review agent inspects the conversation and decides
 * what to persist: durable user facts go to memory, reusable procedures go to
 * skills. It runs with a RESTRICTED toolset (`memory` + `skill_manage` only),
 * never writes into the user transcript, and routes every write through the
 * write-approval gate (origin = "background_review").
 */

import {
  MemoryStore,
  SkillLibrary,
  PendingWriteStore,
  evaluateGateAsync,
  skillGist,
  type GateContext,
  type MemoryTarget,
  type ApprovalSubsystem,
} from "@agent-kit/core";

export const MEMORY_REVIEW_PROMPT =
  "Review the conversation above and consider saving to memory if appropriate.\n\n" +
  "Focus on:\n" +
  "1. Has the user revealed things about themselves — their persona, desires, " +
  "preferences, or personal details worth remembering?\n" +
  "2. Has the user expressed expectations about how you should behave, their work " +
  "style, or ways they want you to operate?\n\n" +
  "If something stands out, save it using the memory tool. " +
  "If nothing is worth saving, just say 'Nothing to save.' and stop.";

export const SKILL_REVIEW_PROMPT =
  "Review the conversation above and update the skill library. Be " +
  "ACTIVE — most sessions produce at least one skill update, even if " +
  "small. A pass that does nothing is a missed learning opportunity, " +
  "not a neutral outcome.\n\n" +
  "Target shape of the library: CLASS-LEVEL skills, each with a rich " +
  "SKILL.md and a `references/` directory for session-specific detail. " +
  "Not a long flat list of narrow one-session-one-skill entries.\n\n" +
  "Signals to look for (any one warrants action): user corrected your " +
  "style/tone/format/verbosity; user corrected your workflow; a non-trivial " +
  "technique, fix, or workaround emerged; a loaded skill turned out wrong or " +
  "outdated.\n\n" +
  "Preference order: (1) patch a currently-loaded curator-managed skill, " +
  "(2) patch an existing umbrella, (3) add a support file under an existing " +
  "umbrella (references/, templates/, scripts/), (4) create a new class-level " +
  "umbrella skill. Do NOT edit bundled, pinned, or user-owned skills. " +
  "Do NOT capture environment-dependent failures, negative tool claims, " +
  "transient resolved errors, or one-off task narratives. " +
  "If nothing stands out, say 'Nothing to save.' and stop.";

export const COMBINED_REVIEW_PROMPT =
  "Review the conversation above and update two things:\n\n" +
  "**Memory**: who the user is. Save durable facts and preferences with the " +
  "memory tool.\n\n" +
  "**Skills**: how to do this class of task. Be ACTIVE — most sessions produce " +
  "at least one skill update. Target class-level umbrella skills with a rich " +
  "SKILL.md and references/ for session-specific detail. Embed user-preference " +
  "lessons into the governing skill, not just memory. Do NOT edit protected " +
  "(bundled/pinned/user-owned) skills. Do NOT capture environment-dependent " +
  "failures, negative tool claims, transient resolved errors, or one-off " +
  "narratives.\n\n" +
  "Act on whichever dimension has real signal. If genuinely nothing stands " +
  "out, say 'Nothing to save.' and stop.";

export interface ReviewMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

/**
 * Minimal LLM runner the curator needs: given a system prompt, the
 * conversation, and a restricted tool surface, return the assistant's final
 * text plus any tool calls it wants to make. The host wires this to a cheap
 * auxiliary model (Hermes runs the review on the main model's warm cache or a
 * cheaper model).
 */
export type CuratorModelRunner = (input: {
  systemPrompt: string;
  messages: ReviewMessage[];
  tools: string[]; // ["memory", "skill_manage"]
}) => Promise<{
  text: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
}>;

export interface CuratorDeps {
  memory: MemoryStore;
  skills: SkillLibrary;
  pending: PendingWriteStore;
  writeApprovalEnabled: (subsystem: ApprovalSubsystem) => boolean;
  /** Which prompt to use. */
  mode?: "memory" | "skills" | "combined";
  model: CuratorModelRunner;
}

export interface CuratorOutcome {
  reviewText: string;
  staged: { subsystem: ApprovalSubsystem; id: string; summary: string }[];
  applied: { subsystem: ApprovalSubsystem; summary: string }[];
  errors: string[];
}

const CURATOR_SYSTEM =
  "You are the background self-improvement curator. You review a completed " +
  "agent session and decide what durable knowledge to persist. You have ONLY " +
  "the memory and skill_manage tools. You never reply to the user; your output " +
  "is a short internal note plus tool calls.";

/**
 * Run one background review pass over a finished conversation.
 */
export async function runBackgroundReview(
  conversation: ReviewMessage[],
  deps: CuratorDeps,
): Promise<CuratorOutcome> {
  const mode = deps.mode ?? "combined";
  const prompt =
    mode === "memory" ? MEMORY_REVIEW_PROMPT : mode === "skills" ? SKILL_REVIEW_PROMPT : COMBINED_REVIEW_PROMPT;

  const gateCtx: GateContext = {
    writeApprovalEnabled: deps.writeApprovalEnabled,
    origin: "background_review",
  };

  const result = await deps.model({
    systemPrompt: CURATOR_SYSTEM + "\n\n" + prompt,
    messages: conversation,
    tools: ["memory", "skill_manage"],
  });

  const outcome: CuratorOutcome = { reviewText: result.text, staged: [], applied: [], errors: [] };

  for (const call of result.toolCalls) {
    try {
      if (call.name === "memory") {
        await handleMemoryCall(call.args, deps, gateCtx, outcome);
      } else if (call.name === "skill_manage") {
        await handleSkillCall(call.args, deps, gateCtx, outcome);
      }
    } catch (e) {
      outcome.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return outcome;
}

async function handleMemoryCall(
  args: Record<string, unknown>,
  deps: CuratorDeps,
  gateCtx: GateContext,
  outcome: CuratorOutcome,
): Promise<void> {
  const target = (args.target as MemoryTarget) ?? "memory";
  const summary = memorySummary(args);

  // Background origin always stages when the gate is on.
  const decision = await evaluateGateAsync("memory", gateCtx, { summary });
  if (decision.kind === "blocked") {
    outcome.errors.push(decision.message);
    return;
  }
  if (decision.kind === "stage") {
    const rec = await deps.pending.stage("memory", args, { summary, origin: "background_review" });
    outcome.staged.push({ subsystem: "memory", id: rec.id, summary });
    return;
  }
  await applyMemory(args, target, deps);
  outcome.applied.push({ subsystem: "memory", summary });
}

function memorySummary(args: Record<string, unknown>): string {
  const action = (args.action as string) ?? "batch";
  const content = (args.content as string) ?? "";
  return content ? `${action}: ${content.slice(0, 60)}` : `memory ${action}`;
}

async function applyMemory(
  args: Record<string, unknown>,
  target: MemoryTarget,
  deps: CuratorDeps,
): Promise<void> {
  if (Array.isArray(args.operations)) {
    await deps.memory.applyBatch(target, args.operations as never[]);
    return;
  }
  const action = args.action as string;
  if (action === "add") await deps.memory.add(target, (args.content as string) ?? "");
  else if (action === "replace") await deps.memory.replace(target, (args.old_text as string) ?? "", (args.content as string) ?? "");
  else if (action === "remove") await deps.memory.remove(target, (args.old_text as string) ?? "");
}

async function handleSkillCall(
  args: Record<string, unknown>,
  deps: CuratorDeps,
  gateCtx: GateContext,
  outcome: CuratorOutcome,
): Promise<void> {
  const action = (args.action as string) ?? "";
  const name = (args.name as string) ?? "";
  const summary = skillGist(action, name, {
    content: args.content as string,
    file_path: args.file_path as string,
    old_string: args.old_string as string,
    new_string: args.new_string as string,
  });

  // Skills always stage when the gate is on (too big to review inline).
  const decision = await evaluateGateAsync("skills", gateCtx, { summary });
  if (decision.kind === "blocked") {
    outcome.errors.push(decision.message);
    return;
  }
  if (decision.kind === "stage") {
    const rec = await deps.pending.stage("skills", args, { summary, origin: "background_review" });
    outcome.staged.push({ subsystem: "skills", id: rec.id, summary });
    return;
  }
  await applySkill(args, deps);
  outcome.applied.push({ subsystem: "skills", summary });
}

/** Replay an approved staged skill write (used by the approval flow too). */
export async function applySkill(args: Record<string, unknown>, deps: Pick<CuratorDeps, "skills">): Promise<unknown> {
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
