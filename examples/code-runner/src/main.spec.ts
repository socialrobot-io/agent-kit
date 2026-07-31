/**
 * Offline smoke: mocked model calls bash → js-exec; no API key, no network.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import {
  createTenantHome,
  defineAgent,
  resetTenantHomeCache,
} from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent.js";

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
      throw new Error("streaming not used");
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
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: name,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: USAGE,
  };
}

afterEach(() => {
  resetTenantHomeCache();
});

describe("code-runner example", () => {
  it("runs js-exec via the sandbox bash tool under a mocked model", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agent-kit-code-runner-test-"));
    try {
      const model = mockModel([
        toolCallStep("bash", {
          command: 'js-exec -c "console.log([1,2,3,4,5,6,7,8,9,10].reduce((a,b)=>a+b,0))"',
        }),
        textStep("The sum of 1..10 is 55."),
      ]);

      const serverTime: SessionTool = {
        name: "server_time",
        description: "Return the host server time as an ISO string.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => ({ now: "2026-01-01T00:00:00.000Z" }),
      };

      const home = await createTenantHome({
        tenantId: "code-runner-test",
        dataDir,
        agent,
        model,
        definition: defineAgent({
          model: "unused/label",
          config: {
            curator: false,
            writeApproval: { memory: false, skills: false },
          },
        }),
        sandbox: { javascript: true, defenseInDepth: false },
        workspaceFiles: { "README.md": "# workspace\n" },
        transcripts: false,
      });

      const session = await home.openSession("s1", { addTools: [serverTime] });
      const turn = await session.run([
        { role: "user", content: "Sum 1..10 with js-exec." },
      ]);

      expect(turn.toolCalls.map((c) => c.name)).toContain("bash");
      const bashCall = turn.toolCalls.find((c) => c.name === "bash");
      expect(String((bashCall?.args as { command?: string })?.command ?? "")).toContain("js-exec");
      expect(turn.text).toContain("55");

      // Direct sanity: runtime is wired.
      const direct = await home.bash!.bash.exec(
        'js-exec -c "console.log(1 + 2)"',
      );
      expect(direct.exitCode).toBe(0);
      expect(direct.stdout).toContain("3");
    } finally {
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
