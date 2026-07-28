import { describe, it, expect } from "vitest";
import type { LanguageModel } from "ai";
import { AgentSessionRuntime, defineAgent, InMemoryFs } from "@agent-kit/core";
import { resolveModel } from "./models.js";
import { toAiTools } from "./tools.js";
import { runAgentTurn, aiCuratorRunner } from "./agent-loop.js";

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

type GenResult = {
  content: unknown[];
  finishReason: { unified: string; raw: string };
  usage: typeof USAGE;
};

/** Minimal offline LanguageModel (V4 spec): replays a queue of results. */
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

function toolCallStep(name: string, input: unknown, id = "call-1"): GenResult {
  return {
    content: [{ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: USAGE,
  };
}

async function makeRuntime() {
  const fs = new InMemoryFs();
  await fs.writeFile("agent/SOUL.md", "You are concise.");
  const runtime = new AgentSessionRuntime({ tenantId: "t1", fs });
  await runtime.init();
  return { fs, runtime };
}

describe("resolveModel", () => {
  it("returns a LanguageModel instance unchanged", () => {
    const m = mockModel([textStep("x")]);
    expect(resolveModel(m)).toBe(m);
  });
});

describe("toAiTools", () => {
  it("converts runtime tools into an AI SDK ToolSet keyed by name", async () => {
    const { runtime } = await makeRuntime();
    const set = toAiTools(runtime.tools());
    expect(Object.keys(set).sort()).toEqual(["memory", "skill_manage", "skill_view", "skills_list"]);
    const exec = set.memory.execute as (args: unknown, opts?: unknown) => Promise<unknown>;
    const res = (await exec({ action: "add", target: "user", content: "likes tabs" })) as {
      success: boolean;
    };
    expect(res.success).toBe(true);
    expect(runtime.memory.getEntries("user")).toContain("likes tabs");
  });
});

describe("runAgentTurn", () => {
  it("runs a live model through the Hermes tools to a final answer", async () => {
    const { runtime } = await makeRuntime();
    const model = mockModel([
      toolCallStep("memory", { action: "add", target: "user", content: "User wants terse answers" }),
      textStep("Noted — I'll keep it terse."),
    ]);

    const result = await runAgentTurn([{ role: "user", content: "Stop being verbose." }], {
      runtime,
      model,
    });

    expect(result.text).toContain("terse");
    expect(result.toolCalls).toEqual([
      { name: "memory", args: { action: "add", target: "user", content: "User wants terse answers" } },
    ]);
    // The tool actually ran against the live memory store.
    expect(runtime.memory.getEntries("user")).toContain("User wants terse answers");
  });

  it("resolves the model from definition.model when not passed explicitly", async () => {
    const { runtime } = await makeRuntime();
    const model = mockModel([textStep("done")]);
    const result = await runAgentTurn([{ role: "user", content: "hi" }], {
      runtime,
      definition: defineAgent({ model: model as unknown as string }),
    });
    expect(result.text).toBe("done");
  });

  it("throws without a model", async () => {
    const { runtime } = await makeRuntime();
    await expect(runAgentTurn([{ role: "user", content: "hi" }], { runtime })).rejects.toThrow(/model/);
  });
});

describe("aiCuratorRunner", () => {
  it("extracts memory + skill_manage tool calls from the review model", async () => {
    const model = mockModel([
      toolCallStep("memory", { action: "add", target: "user", content: "prefers terse" }, "c1"),
      toolCallStep(
        "skill_manage",
        { action: "create", name: "concise", content: "---\ndescription: be concise\n---" },
        "c2",
      ),
      textStep("Saved a preference and a skill."),
    ]);
    const runner = aiCuratorRunner(model);
    const out = await runner({
      systemPrompt: "You are the curator. Review and save.",
      messages: [{ role: "user", content: "I hate verbose answers." }],
    });
    expect(out.toolCalls.map((t: { name: string }) => t.name)).toEqual(["memory", "skill_manage"]);
    expect(out.text).toContain("Saved");
  });
});
