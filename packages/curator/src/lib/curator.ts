/**
 * Background self-improvement review (the "curator").
 *
 * TypeScript port of upstream `agent/background_review.py` prompts and runner
 * contract (see `vendor/hermes`, MIT).
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
  submitGatedWrite,
  applySkillArgs,
  type GateContext,
  type ApprovalSubsystem,
} from "@socialrobot-io/agent-kit-core";

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
  "umbrella skill. New SKILL.md files must use agentskills.io frontmatter: " +
  "required `name` (matching the skill folder) and `description` (≤60 chars, " +
  "trigger first), then a non-empty body. Do NOT edit bundled, pinned, locked, " +
  "or framework skills. Do NOT capture environment-dependent failures, negative " +
  "tool claims, transient resolved errors, or one-off task narratives. " +
  "If nothing stands out, say 'Nothing to save.' and stop.";

export const COMBINED_REVIEW_PROMPT =
  "Review the conversation above and update two things:\n\n" +
  "**Memory**: who the user is. Save durable facts and preferences with the " +
  "memory tool.\n\n" +
  "**Skills**: how to do this class of task. Be ACTIVE — most sessions produce " +
  "at least one skill update. Target class-level umbrella skills with a rich " +
  "SKILL.md and references/ for session-specific detail. New SKILL.md files " +
  "need agentskills.io frontmatter (`name` matching the folder, `description` " +
  "≤60 chars) plus a non-empty body. Embed user-preference lessons into the " +
  "governing skill, not just memory. Do NOT edit protected (bundled/pinned/" +
  "locked/framework) skills. Do NOT capture environment-dependent failures, negative " +
  "tool claims, transient resolved errors, or one-off narratives.\n\n" +
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
 * auxiliary model (or reuses the main model's warm cache).
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
  const gatedDeps = { memory: deps.memory, skills: deps.skills, pending: deps.pending };

  for (const call of result.toolCalls) {
    try {
      if (call.name === "memory") {
        const write = await submitGatedWrite("memory", call.args, gatedDeps, gateCtx);
        recordGatedOutcome("memory", write, outcome);
      } else if (call.name === "skill_manage") {
        const write = await submitGatedWrite("skills", call.args, gatedDeps, gateCtx);
        recordGatedOutcome("skills", write, outcome);
      }
    } catch (e) {
      outcome.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return outcome;
}

function recordGatedOutcome(
  subsystem: ApprovalSubsystem,
  write: Awaited<ReturnType<typeof submitGatedWrite>>,
  outcome: CuratorOutcome,
): void {
  if (write.kind === "blocked" || write.kind === "error") {
    outcome.errors.push(write.error);
    return;
  }
  if (write.kind === "staged") {
    outcome.staged.push({ subsystem, id: write.id, summary: write.summary });
    return;
  }
  outcome.applied.push({ subsystem, summary: write.summary });
}

/** @deprecated Use `applySkillArgs` from `@socialrobot-io/agent-kit-core`. */
export async function applySkill(
  args: Record<string, unknown>,
  deps: Pick<CuratorDeps, "skills">,
): Promise<unknown> {
  return applySkillArgs(args, deps);
}
