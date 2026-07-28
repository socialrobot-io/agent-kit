/**
 * Offline LanguageModel (AI SDK v4 spec) that replays a queue of generate results.
 * Tool-call `input` MUST be a stringified JSON string so the SDK runs tools client-side.
 */

import type { LanguageModel } from "ai";

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

export type GenResult = {
  content: unknown[];
  finishReason: { unified: string; raw: string };
  usage: typeof USAGE;
};

export function mockModel(results: GenResult[]): LanguageModel {
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

export function textStep(text: string): GenResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: USAGE,
  };
}

export function toolCallStep(name: string, input: unknown, id = "call-1"): GenResult {
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
