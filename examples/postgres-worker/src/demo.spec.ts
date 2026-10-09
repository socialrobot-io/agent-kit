/**
 * Offline smoke test: the whole demo on PGlite with scripted models.
 * No API key, no network, no Postgres server.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { resetTenantHomeCache } from "@socialrobot-io/agent-kit-node";
import { openDatabase, type Database } from "./db";
import { FIRST_MESSAGE, runDemo, TENANT } from "./demo";

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

type Step = { text: string } | { tools: { name: string; input: unknown }[] };

/** Offline model (v4 spec) that replays steps and records each prompt. */
function scriptedModel(steps: Step[]) {
  const queue = [...steps];
  const prompts: unknown[] = [];
  const model = {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    async doGenerate(options: { prompt: unknown }) {
      prompts.push(options.prompt);
      const step = queue.shift() ?? { text: "Done." };
      return "tools" in step
        ? {
            content: step.tools.map((tool, i) => ({
              type: "tool-call",
              toolCallId: `call-${prompts.length}-${i}`,
              toolName: tool.name,
              input: JSON.stringify(tool.input),
            })),
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: USAGE,
            warnings: [],
          }
        : {
            content: [{ type: "text", text: step.text }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: USAGE,
            warnings: [],
          };
    },
    async doStream() {
      throw new Error("the demo uses run(), not stream()");
    },
  } as unknown as LanguageModel;
  return { model, prompts };
}

const PREFERENCE = "Posts are two sentences at most, with no emojis.";
const FACT = "Rye & Co. is a small bakery in Lisbon.";

function models() {
  const chat = scriptedModel([
    { text: "Nice to meet you! Tell me what you'd like to post." },
    { text: "Our new sourdough is here. Come try a slice this week." },
  ]);
  const curator = scriptedModel([
    {
      tools: [
        { name: "memory", input: { action: "add", target: "user", content: PREFERENCE } },
        { name: "memory", input: { action: "add", target: "memory", content: FACT } },
      ],
    },
    { text: "Saved the owner's style and the bakery facts." },
  ]);
  return { chat, curator };
}

let database: Database | undefined;

afterEach(async () => {
  resetTenantHomeCache();
  await database?.close();
  database = undefined;
});

describe("postgres-worker demo", () => {
  it("queues the review, learns in the worker, and remembers in the next chat", async () => {
    database = await openDatabase("");
    const { chat, curator } = models();

    const result = await runDemo({
      db: database.db,
      chatModel: chat.model,
      curatorModel: curator.model,
      today: "2026-01-02",
    });

    // The web kit queued plain data for the worker; it did not review itself.
    expect(result.job).toMatchObject({ v: 1, tenantId: TENANT, sessionId: "chat-1" });
    expect(result.job.conversation.map((m) => m.content)).toContain(FIRST_MESSAGE);

    // writeApproval is on by default: the worker stages, the owner approves.
    expect(result.review?.staged).toHaveLength(2);
    expect(result.review?.applied).toHaveLength(0);
    expect(result.approved).toHaveLength(2);
    expect(result.remembered).toEqual({ memory: [FACT], user: [PREFERENCE] });

    // The next chat starts with the memory, and gets the turn's date after it.
    expect(result.secondPrompt).toContain(PREFERENCE);
    const secondChatCall = JSON.stringify(chat.prompts.at(-1));
    expect(secondChatCall).toContain(FACT);
    expect(secondChatCall).toContain("Today is 2026-01-02.");

    // Other tenants share the tables, not the memory.
    expect(result.otherTenant).toEqual({ memory: [], user: [] });
  });

  it("keeps what was learned when the processes restart", async () => {
    database = await openDatabase("");
    const first = models();
    await runDemo({
      db: database.db,
      chatModel: first.chat.model,
      curatorModel: first.curator.model,
    });

    // New kits on the same database, as after a deploy.
    resetTenantHomeCache();
    const again = models();
    const result = await runDemo({
      db: database.db,
      chatModel: again.chat.model,
      curatorModel: again.curator.model,
    });
    expect(result.remembered).toEqual({ memory: [FACT], user: [PREFERENCE] });
    expect(JSON.stringify(again.chat.prompts[0])).toContain(PREFERENCE);
  });
});
