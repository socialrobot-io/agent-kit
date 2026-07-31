/**
 * Hermes-style after-turn curator wiring for createTenantHome sessions.
 */

import type { AgentDefinition } from "@socialrobot-io/agent-kit-core";
import {
  runBackgroundReview,
  type CuratorModelRunner,
  type ReviewMessage,
} from "@socialrobot-io/agent-kit-curator";
import {
  aiCuratorRunner,
  type AgentSession,
  type ResolveModelOptions,
  type SessionTurnOptions,
} from "@socialrobot-io/agent-kit-ai";
import type { ModelMessage } from "ai";

export type CuratorMode = "memory" | "skills" | "combined";

export interface ResolvedCuratorConfig {
  mode: CuratorMode;
  /** Apply curator proposals immediately (host trust; default false). */
  autoApprove: boolean;
}

/** In-flight curator tasks (tests can {@link waitForSessionCurators}). */
const pendingCurators = new Set<Promise<unknown>>();

/** Resolve curator config after {@link defineAgent}. Returns false when disabled. */
export function resolveCuratorConfig(
  definition: AgentDefinition,
): ResolvedCuratorConfig | false {
  const c = definition.config?.curator;
  if (c === false) return false;
  if (typeof c === "object") {
    return {
      mode: c.mode ?? "combined",
      autoApprove: c.autoApprove ?? false,
    };
  }
  return { mode: "combined", autoApprove: false };
}

function textFromContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && "type" in part && part.type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

/** Build curator conversation from turn messages + assistant reply. */
export function conversationForReview(
  messages: ModelMessage[],
  assistantText: string,
): ReviewMessage[] {
  const out: ReviewMessage[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
    const content = textFromContent(m.content);
    if (!content && m.role !== "assistant") continue;
    out.push({ role: m.role, content: content || "(empty)" });
  }
  if (assistantText.trim()) {
    out.push({ role: "assistant", content: assistantText });
  }
  return out;
}

function scheduleCurator(task: Promise<unknown>): void {
  const tracked = task.finally(() => {
    pendingCurators.delete(tracked);
  });
  pendingCurators.add(tracked);
  void tracked.catch(() => {
    // Errors are logged inside the task; never reject the host turn.
  });
}

/** Await in-flight curator passes (tests). */
export async function waitForSessionCurators(): Promise<void> {
  while (pendingCurators.size > 0) {
    await Promise.all([...pendingCurators]);
  }
}

export interface AttachSessionCuratorOptions {
  definition: AgentDefinition;
  resolveOpts?: ResolveModelOptions;
  /** Override model runner (tests or cheaper aux model). */
  curatorRunner?: CuratorModelRunner;
}

/**
 * Wrap session run/stream so a completed turn schedules background review.
 * Does not block the user-facing reply.
 */
export function attachSessionCurator(
  session: AgentSession,
  opts: AttachSessionCuratorOptions,
): AgentSession {
  const cfg = resolveCuratorConfig(opts.definition);
  if (!cfg) return session;

  const writeApproval = opts.definition.config?.writeApproval;
  // Curator-only auto-approve: reuse the existing allow path by disabling
  // the gate for this run. Foreground session tools still use writeApproval.
  const writeApprovalEnabled = cfg.autoApprove
    ? () => false
    : (subsystem: "memory" | "skills") =>
        subsystem === "memory" ? !!writeApproval?.memory : !!writeApproval?.skills;

  const runner: CuratorModelRunner =
    opts.curatorRunner ??
    (aiCuratorRunner(session.model, opts.resolveOpts) as CuratorModelRunner);

  const kick = (messages: ModelMessage[], assistantText: string) => {
    const conversation = conversationForReview(messages, assistantText);
    if (conversation.length === 0) return;
    scheduleCurator(
      runBackgroundReview(conversation, {
        memory: session.memory,
        skills: session.skills,
        pending: session.pending,
        writeApprovalEnabled,
        mode: cfg.mode,
        model: runner,
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[agent-kit] curator failed:", message);
      }),
    );
  };

  const baseRun = session.run.bind(session);
  const baseStream = session.stream.bind(session);

  return {
    ...session,
    run: async (messages, turnOpts) => {
      const result = await baseRun(messages, turnOpts);
      kick(messages, result.text || "");
      return result;
    },
    stream: (messages, turnOpts) => {
      const hostOnFinish = turnOpts?.onFinish;
      const nextOpts: SessionTurnOptions = {
        ...turnOpts,
        onFinish: async (event) => {
          await hostOnFinish?.(event);
          kick(messages, event.text || "");
        },
      };
      return baseStream(messages, nextOpts);
    },
  };
}
