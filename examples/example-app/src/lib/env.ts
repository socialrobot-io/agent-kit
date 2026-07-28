/**
 * Live model resolution for the example.
 * Prefer @ai-sdk/deepseek + DEEPSEEK_API_KEY; fall back to the AI Gateway.
 */

import type { LanguageModel } from "ai";
import { deepSeek } from "@ai-sdk/deepseek";
import { resolveModel } from "@socialrobot-io/agent-kit-ai";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_GATEWAY_MODEL = "deepseek/deepseek-v4-flash";

export type LiveModel = {
  model: LanguageModel;
  label: string;
  provider: "deepseek" | "gateway";
};

export function hasApiKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.AI_GATEWAY_API_KEY);
}

export function resolveLiveModel(): LiveModel {
  if (process.env.DEEPSEEK_API_KEY) {
    const raw = process.env.MODEL ?? DEFAULT_DEEPSEEK_MODEL;
    const id = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
    return { model: deepSeek(id), label: id, provider: "deepseek" };
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      "Set DEEPSEEK_API_KEY (preferred) or AI_GATEWAY_API_KEY in .env.local. See .env.sample.",
    );
  }

  const id = process.env.MODEL ?? DEFAULT_GATEWAY_MODEL;
  return { model: resolveModel(id), label: id, provider: "gateway" };
}
