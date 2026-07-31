import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import type { CuratorModelRunner } from "@socialrobot-io/agent-kit-curator";
import { createTenantHome, resetTenantHomeCache } from "./tenant-home.js";
import {
  conversationForReview,
  resolveCuratorConfig,
  waitForSessionCurators,
} from "./session-curator.js";

afterEach(async () => {
  await waitForSessionCurators();
  resetTenantHomeCache();
});

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function mockModel(text = "ok"): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
    async doStream() {
      return {
        stream: (async function* () {
          yield { type: "text-delta", id: "1", delta: text } as const;
          yield {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: USAGE,
          } as const;
        })(),
      };
    },
  } as unknown as LanguageModel;
}

describe("resolveCuratorConfig", () => {
  it("defaults to combined when curator is true", () => {
    expect(resolveCuratorConfig(defineAgent({ model: "m" }))).toEqual({ mode: "combined" });
  });

  it("respects false and mode", () => {
    expect(
      resolveCuratorConfig(defineAgent({ model: "m", config: { curator: false } })),
    ).toBe(false);
    expect(
      resolveCuratorConfig(defineAgent({ model: "m", config: { curator: { mode: "memory" } } })),
    ).toEqual({ mode: "memory" });
  });
});

describe("conversationForReview", () => {
  it("appends assistant text to turn messages", () => {
    expect(
      conversationForReview([{ role: "user", content: "Hi" }], "Hello there"),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there" },
    ]);
  });
});

describe("attachSessionCurator via createTenantHome", () => {
  it("runs curator after a turn and stages memory when approval is on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-curator-"));
    const calls: { mode?: string; tools: string[] }[] = [];
    const runner: CuratorModelRunner = async (input) => {
      calls.push({ mode: undefined, tools: input.tools });
      return {
        text: "Saving preference.",
        toolCalls: [
          {
            name: "memory",
            args: { action: "add", target: "user", content: "Prefers short answers." },
          },
        ],
      };
    };

    try {
      const home = await createTenantHome({
        tenantId: "t1",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
        curatorRunner: runner,
      });
      const session = await home.openSession("chat-1");
      const turn = await session.run([{ role: "user", content: "Keep answers short." }]);
      expect(turn.text).toBe("ok");
      await waitForSessionCurators();

      expect(calls).toHaveLength(1);
      expect(calls[0]!.tools).toEqual(["memory", "skill_manage"]);
      const pending = await session.pending.list("memory");
      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.some((p) => p.summary.includes("Prefers short") || p.payload.content === "Prefers short answers.")).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips curator when config.curator is false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-curator-off-"));
    let called = 0;
    const runner: CuratorModelRunner = async () => {
      called += 1;
      return { text: "", toolCalls: [] };
    };

    try {
      const home = await createTenantHome({
        tenantId: "t1",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
        definition: defineAgent({ model: "mock", config: { curator: false } }),
        curatorRunner: runner,
      });
      const session = await home.openSession("chat-1");
      await session.run([{ role: "user", content: "Hi" }]);
      await waitForSessionCurators();
      expect(called).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("forwards mode memory into the curator system prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-curator-mode-"));
    const prompts: string[] = [];

    try {
      const home = await createTenantHome({
        tenantId: "t1",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
        definition: defineAgent({ model: "mock", config: { curator: { mode: "memory" } } }),
        curatorRunner: async (input) => {
          prompts.push(input.systemPrompt);
          return { text: "Nothing to save.", toolCalls: [] };
        },
      });
      const session = await home.openSession("chat-1");
      await session.run([{ role: "user", content: "Hi" }]);
      await waitForSessionCurators();
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("saving to memory if appropriate");
      expect(prompts[0]).not.toContain("update the skill library");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not block run return on a slow curator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-curator-slow-"));
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let curatorDone = false;

    try {
      const home = await createTenantHome({
        tenantId: "t1",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
        curatorRunner: async () => {
          await gate;
          curatorDone = true;
          return { text: "", toolCalls: [] };
        },
      });
      const session = await home.openSession("chat-1");
      const turn = await session.run([{ role: "user", content: "Hi" }]);
      expect(turn.text).toBe("ok");
      expect(curatorDone).toBe(false);
      release();
      await waitForSessionCurators();
      expect(curatorDone).toBe(true);
    } finally {
      release?.();
      await waitForSessionCurators();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stream onFinish schedules curator after the host callback", async () => {
    const { openAgentSession } = await import("@socialrobot-io/agent-kit-ai");
    const { InMemoryFs } = await import("@socialrobot-io/agent-kit-core");
    const { attachSessionCurator } = await import("./session-curator.js");
    const order: string[] = [];
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are brief.");
    const definition = defineAgent({ model: "mock" });
    const base = await openAgentSession({
      tenantId: "t1",
      fs,
      definition,
      model: mockModel(),
    });
    base.stream = ((_messages, opts) => {
      const text = (async () => {
        // Minimal finish event for the curator wrap (only `.text` is read).
        await opts?.onFinish?.({ text: "streamed" } as never);
        return "streamed";
      })();
      return { text } as unknown as ReturnType<typeof base.stream>;
    }) as typeof base.stream;

    const session = attachSessionCurator(base, {
      definition,
      curatorRunner: async () => {
        order.push("curator");
        return { text: "", toolCalls: [] };
      },
    });
    const result = session.stream([{ role: "user", content: "Hi" }], {
      onFinish: async () => {
        order.push("host");
      },
    });
    await result.text;
    await waitForSessionCurators();
    expect(order).toEqual(["host", "curator"]);
  });
});
