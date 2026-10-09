/**
 * Hermes-style after-turn curator wiring for createTenantHome sessions.
 *
 * Two ways to run a review after a turn:
 *  - In process (default): the review runs in the background of the process
 *    that served the turn.
 *  - Through a host queue: the kit hands a JSON-serializable
 *    {@link CuratorJob} to `curatorQueue`, and a worker that opens the same
 *    storage runs it later with `home.review(job)` or `kit.review(job)`.
 */

import type {
  AgentDefinition,
  MemoryStore,
  PendingWriteStore,
  SkillLibrary,
} from "@socialrobot-io/agent-kit-core";
import {
  runBackgroundReview,
  type CuratorModelRunner,
  type CuratorOutcome,
  type ReviewMessage,
} from "@socialrobot-io/agent-kit-curator";
import {
  aiCuratorRunner,
  type AgentSession,
  type ModelInput,
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

/**
 * One curator review, as handed to a host queue. JSON-serializable.
 *
 * The job carries only what to review. Policy (mode, autoApprove, write
 * approval) comes from the agent definition of the worker that runs it, so
 * a job payload in a queue cannot widen what the curator may write.
 */
export interface CuratorJob {
  /** Job format version. */
  v: 1;
  /** Tenant whose memory and skills the review may change. */
  tenantId: string;
  /** Chat the conversation came from. */
  sessionId: string;
  /** Conversation to review, oldest first. Text only. */
  conversation: ReviewMessage[];
  /** Unix timestamp (seconds) when the turn completed. */
  createdAt: number;
}

/** Hands a curator job to the host's queue. */
export type CuratorQueue = (job: CuratorJob) => void | Promise<void>;

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

const JOB_ROLES = new Set<ReviewMessage["role"]>(["user", "assistant", "system", "tool"]);
/** Bounds for a job read back from a queue (a trust boundary). */
const MAX_JOB_MESSAGES = 500;
const MAX_JOB_MESSAGE_CHARS = 100_000;

/**
 * Check a curator job read back from a queue. Throws on a bad shape.
 * Content is still threat-scanned when the curator writes memory or skills.
 */
export function parseCuratorJob(input: unknown): CuratorJob {
  const job = input as Partial<CuratorJob> | null;
  if (!job || typeof job !== "object") throw new Error("curator job: not an object");
  if (job.v !== 1) throw new Error(`curator job: unsupported version ${String(job.v)}`);
  if (typeof job.tenantId !== "string" || !job.tenantId.trim()) {
    throw new Error("curator job: tenantId is required");
  }
  if (typeof job.sessionId !== "string" || !job.sessionId.trim()) {
    throw new Error("curator job: sessionId is required");
  }
  if (!Array.isArray(job.conversation) || job.conversation.length > MAX_JOB_MESSAGES) {
    throw new Error("curator job: conversation must be an array of at most 500 messages");
  }
  const conversation = job.conversation.map((m, i) => {
    if (!m || typeof m !== "object" || !JOB_ROLES.has(m.role) || typeof m.content !== "string") {
      throw new Error(`curator job: bad message at index ${i}`);
    }
    return { role: m.role, content: m.content.slice(0, MAX_JOB_MESSAGE_CHARS) };
  });
  const createdAt = typeof job.createdAt === "number" ? job.createdAt : Date.now() / 1000;
  return { v: 1, tenantId: job.tenantId, sessionId: job.sessionId, conversation, createdAt };
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

/** Stores a review reads and writes. */
export interface CuratorStores {
  memory: MemoryStore;
  skills: SkillLibrary;
  pending: PendingWriteStore;
}

/**
 * Run one curator review with the policy from `definition`. Shared by the
 * in-process path and `home.review` (queue workers).
 *
 * @returns The review outcome, or `null` when the curator is disabled.
 */
export async function reviewConversation(
  conversation: ReviewMessage[],
  opts: {
    definition: AgentDefinition;
    stores: CuratorStores;
    runner: CuratorModelRunner;
  },
): Promise<CuratorOutcome | null> {
  const cfg = resolveCuratorConfig(opts.definition);
  if (!cfg || conversation.length === 0) return null;

  const writeApproval = opts.definition.config?.writeApproval;
  // Curator-only auto-approve: reuse the existing allow path by disabling
  // the gate for this run. Foreground session tools still use writeApproval.
  const writeApprovalEnabled = cfg.autoApprove
    ? () => false
    : (subsystem: "memory" | "skills") =>
        subsystem === "memory" ? !!writeApproval?.memory : !!writeApproval?.skills;

  return runBackgroundReview(conversation, {
    memory: opts.stores.memory,
    skills: opts.stores.skills,
    pending: opts.stores.pending,
    writeApprovalEnabled,
    mode: cfg.mode,
    model: opts.runner,
  });
}

/** Curator runner for a model input: the host's runner, else the AI SDK default. */
export function resolveCuratorRunner(
  model: ModelInput,
  opts: { curatorRunner?: CuratorModelRunner; resolveOpts?: ResolveModelOptions } = {},
): CuratorModelRunner {
  return opts.curatorRunner ?? (aiCuratorRunner(model, opts.resolveOpts) as CuratorModelRunner);
}

export interface AttachSessionCuratorOptions {
  definition: AgentDefinition;
  resolveOpts?: ResolveModelOptions;
  /** Override model runner (tests or cheaper aux model). */
  curatorRunner?: CuratorModelRunner;
  /** Model for the review. Default: the session model. Ignored with `curatorRunner`. */
  curatorModel?: ModelInput;
  /**
   * Hand reviews to a host queue instead of running them in this process.
   * Needs `sessionId`.
   */
  curatorQueue?: CuratorQueue;
  /** Chat id recorded on queued jobs. */
  sessionId?: string;
}

/**
 * Wrap session run/stream so a completed turn schedules background review.
 * Does not block the user-facing reply.
 */
export function attachSessionCurator(
  session: AgentSession,
  opts: AttachSessionCuratorOptions,
): AgentSession {
  if (!resolveCuratorConfig(opts.definition)) return session;
  if (opts.curatorQueue && !opts.sessionId) {
    throw new Error("attachSessionCurator: curatorQueue needs sessionId");
  }

  const runner = resolveCuratorRunner(opts.curatorModel ?? session.model, opts);

  const kick = (messages: ModelMessage[], assistantText: string) => {
    const conversation = conversationForReview(messages, assistantText);
    if (conversation.length === 0) return;

    const task = opts.curatorQueue
      ? Promise.resolve().then(() =>
          opts.curatorQueue!({
            v: 1,
            tenantId: session.tenantId,
            sessionId: opts.sessionId!,
            conversation,
            createdAt: Date.now() / 1000,
          }),
        )
      : reviewConversation(conversation, {
          definition: opts.definition,
          stores: { memory: session.memory, skills: session.skills, pending: session.pending },
          runner,
        });

    scheduleCurator(
      task.catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          opts.curatorQueue ? "[agent-kit] curator enqueue failed:" : "[agent-kit] curator failed:",
          message,
        );
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
