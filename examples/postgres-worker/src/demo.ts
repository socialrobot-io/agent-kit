/**
 * The whole loop, narrated: a chat on the web kit, the review job crossing
 * the queue, the worker reviewing it, the owner approving what it staged, and
 * a new chat that starts with the memory. Shared by `main.ts` (live model)
 * and the smoke test (scripted model).
 */

import { fileURLToPath } from "node:url";
import type { LanguageModel } from "ai";
import { approvePendingWrites } from "@socialrobot-io/agent-kit-core";
import {
  loadAgent,
  parseCuratorJob,
  waitForSessionCurators,
  type AgentKit,
  type CuratorJob,
  type CuratorOutcome,
} from "@socialrobot-io/agent-kit-node";
import type { SqlClient } from "@socialrobot-io/agent-kit-node/postgres";
import { createDemoKits } from "./kits";
import { JsonQueue } from "./queue";

const AGENT_DIR = fileURLToPath(new URL("../agents/assistant", import.meta.url));

/** The tenant the demo chats as, and one it never touches. */
export const TENANT = "rye-and-co";
export const OTHER_TENANT = "globex";

export const FIRST_MESSAGE =
  "Hi! I run Rye & Co., a small bakery in Lisbon. Keep posts to two sentences and never use emojis.";
export const SECOND_MESSAGE = "Write a post announcing our new sourdough.";

export interface DemoOptions {
  db: SqlClient;
  chatModel: LanguageModel;
  curatorModel: LanguageModel;
  /** Narration sink. Default: silent. */
  log?: (line: string) => void;
  /** Date given to the model each turn (systemContext). Default: today. */
  today?: string;
}

export interface Remembered {
  memory: string[];
  user: string[];
}

export interface DemoResult {
  firstReply: string;
  job: CuratorJob;
  review: CuratorOutcome | null;
  approved: string[];
  remembered: Remembered;
  secondPrompt: string;
  secondReply: string;
  otherTenant: Remembered;
}

export async function runDemo(opts: DemoOptions): Promise<DemoResult> {
  const log = opts.log ?? (() => {});
  const section = (title: string) => log(`\n== ${title} ==`);
  // Per-turn context goes after the frozen prompt, so prompt caching still applies.
  const systemContext = `Today is ${opts.today ?? new Date().toISOString().slice(0, 10)}.`;

  const queue = new JsonQueue();
  const { web, worker } = createDemoKits({
    db: opts.db,
    agent: await loadAgent(AGENT_DIR),
    chatModel: opts.chatModel,
    curatorModel: opts.curatorModel,
    queue: queue.push,
  });

  section("Session 1 (web)");
  log(`user: ${FIRST_MESSAGE}`);
  const first = await (
    await web.session(TENANT, "chat-1")
  ).run([{ role: "user", content: FIRST_MESSAGE }], { systemContext });
  for (const call of first.steps.flatMap((step) => step.toolCalls)) {
    log(`tool: ${call.toolName} ${JSON.stringify(call.input)}`);
  }
  log(`assistant: ${first.text}`);
  // The kit queues the review after the reply; wait for that hand-off.
  await waitForSessionCurators();

  section("Queue");
  const raw = queue.take();
  if (!raw) throw new Error("the web kit queued no review job");
  log(`one job, ${raw.length} bytes of JSON`);

  section("Curator (worker)");
  // Validate at the boundary: the queue is outside the kit's trust.
  const job = parseCuratorJob(JSON.parse(raw));
  log(`job: tenant=${job.tenantId} session=${job.sessionId} messages=${job.conversation.length}`);
  const review = await worker.review(job);
  for (const write of review?.staged ?? []) log(`staged ${write.subsystem}: ${write.summary}`);
  for (const write of review?.applied ?? []) log(`applied ${write.subsystem}: ${write.summary}`);
  for (const error of review?.errors ?? []) log(`error: ${error}`);

  section("Approve (settings page)");
  // Writes wait for the owner by default (writeApproval). A settings page
  // lists them from home.stores() and applies the ones they accept.
  const stores = await (await web.home(TENANT)).stores();
  const approved = await approvePendingWrites(stores);
  for (const line of approved) log(`approved ${line}`);
  if (approved.length === 0) log("nothing to approve");
  const remembered = await rememberedBy(web, TENANT);
  log(`memory: ${JSON.stringify(remembered)}`);

  section("Session 2 (web, new chat)");
  const second = await web.session(TENANT, "chat-2");
  const secondPrompt = second.runtime.systemPrompt();
  const entries = [...remembered.memory, ...remembered.user];
  log(
    `prompt includes all ${entries.length} memory entries: ${entries.every((e) => secondPrompt.includes(e))}`,
  );
  log(`user: ${SECOND_MESSAGE}`);
  const reply = await second.run([{ role: "user", content: SECOND_MESSAGE }], { systemContext });
  log(`assistant: ${reply.text}`);
  await waitForSessionCurators();
  log(`queue: ${queue.size} job waiting for the worker (this turn's review)`);

  section("Another tenant");
  const otherTenant = await rememberedBy(web, OTHER_TENANT);
  log(`${OTHER_TENANT} memory: ${JSON.stringify(otherTenant)}`);

  return {
    firstReply: first.text,
    job,
    review,
    approved,
    remembered,
    secondPrompt,
    secondReply: reply.text,
    otherTenant,
  };
}

async function rememberedBy(kit: AgentKit, tenantId: string): Promise<Remembered> {
  const { memory } = await (await kit.home(tenantId)).stores();
  return { memory: memory.getEntries("memory"), user: memory.getEntries("user") };
}
