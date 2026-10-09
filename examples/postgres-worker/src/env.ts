/**
 * Live models from the environment (see .env.sample). Missing config prints
 * setup steps and exits instead of throwing a stack.
 */

import type { LanguageModel } from "ai";
import { resolveModel } from "@socialrobot-io/agent-kit-ai";

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export interface LiveModels {
  chatModel: LanguageModel;
  curatorModel: LanguageModel;
  label: string;
}

export function liveModelsOrExit(): LiveModels {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error(
      [
        "AI_GATEWAY_API_KEY is not set.",
        "",
        "  cp .env.sample .env    # then add your Vercel AI Gateway key",
        "  bun start",
        "",
        "The offline test needs no key: bunx nx test example-postgres-worker",
      ].join("\n"),
    );
    process.exit(1);
  }
  const chat = process.env.MODEL || DEFAULT_MODEL;
  const curator = process.env.CURATOR_MODEL || chat;
  return {
    chatModel: resolveModel(chat),
    curatorModel: resolveModel(curator),
    label: curator === chat ? chat : `${chat} (curator: ${curator})`,
  };
}
