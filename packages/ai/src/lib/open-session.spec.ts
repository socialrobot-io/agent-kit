import { describe, it, expect } from "vitest";
import type { LanguageModel } from "ai";
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "./open-session.js";

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

type GenResult = {
  content: unknown[];
  finishReason: { unified: string; raw: string };
  usage: typeof USAGE;
};

function mockModel(results: GenResult[]): LanguageModel {
  const queue = [...results];
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock-model",
    supportedUrls: {},
    async doGenerate() {
      const r = queue.shift() ?? results[results.length - 1];
      return { ...r, warnings: [] };
    },
    async doStream() {
      throw new Error("streaming not used in these tests");
    },
  } as unknown as LanguageModel;
}

function textStep(text: string): GenResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: USAGE,
  };
}

describe("openAgentSession disableTools", () => {
  it("also removes disabled tools from the frozen prompt's guidance", async () => {
    const fs = new InMemoryFs();
    const session = await openAgentSession({
      tenantId: "t1",
      fs,
      definition: defineAgent({ model: mockModel([textStep("ok")]) as unknown as string }),
      disableTools: ["skill_manage"],
    });
    const prompt = session.runtime.systemPrompt();
    expect(prompt).toContain("skill_view");
    expect(prompt).not.toContain("skill_manage");
    expect(Object.keys(session.composeTools().toolSet)).not.toContain("skill_manage");
  });
});

describe("openAgentSession.run", () => {
  it("runs a turn without host unpacking runtime/model/toolSet", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are concise.");
    await fs.writeFile("agent/AGENTS.md", "Be brief.");

    const model = mockModel([textStep("Noted.")]);
    const session = await openAgentSession({
      tenantId: "brand-123",
      fs,
      definition: defineAgent({ model: "unused/label" }),
      model,
    });

    const turn = await session.run([{ role: "user", content: "Hi" }]);
    expect(turn.text).toBe("Noted.");
    expect(session.model).toBe(model);
    expect(session.definition.model).toBe("unused/label");
  });

  it("honors addTools overrides on run", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are helpful.");

    const model = mockModel([
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "ping",
            input: JSON.stringify({}),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage: USAGE,
      },
      textStep("pong"),
    ]);

    const session = await openAgentSession({
      tenantId: "brand-123",
      fs,
      definition: defineAgent({ model: "unused/label" }),
      model,
    });

    const turn = await session.run([{ role: "user", content: "Ping" }], {
      addTools: [
        {
          name: "ping",
          description: "Return pong.",
          inputSchema: { type: "object", properties: {} },
          execute: async () => ({ ok: true }),
        },
      ],
    });

    expect(turn.toolCalls.map((c) => c.toolName)).toContain("ping");
    expect(turn.text).toBe("pong");
  });
});
