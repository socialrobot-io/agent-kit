/**
 * Resolve `defineAgent({ model })` into a live AI SDK `LanguageModel`.
 *
 * Accepts either a ready `LanguageModel` (any provider: OpenAI, Anthropic,
 * Google, Groq, OpenRouter, Azure, Bedrock, …) or a string id. String ids
 * resolve through the Vercel AI Gateway (`@ai-sdk/gateway`), which routes
 * "anthropic/claude-sonnet-4-5", "openai/gpt-5", "google/gemini-2.5-pro", etc.
 * to the right provider with a single API key.
 *
 * This is what makes the model real instead of a label.
 */

import type { LanguageModel } from "ai";
import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";
import type { AgentDefinition } from "@socialrobot-io/agent-kit-core";

export type ModelInput = string | LanguageModel;

export interface ResolveModelOptions {
  /** Pre-built gateway provider (for custom baseURL / apiKey). */
  gateway?: GatewayProvider;
  /** AI Gateway API key. Defaults to process.env.AI_GATEWAY_API_KEY. */
  apiKey?: string;
  /** Override the gateway base URL (self-hosted / proxy). */
  baseURL?: string;
}

/**
 * Resolve a model input to a `LanguageModel`.
 *  - `LanguageModel` instance -> returned as-is.
 *  - "provider/model" string  -> AI Gateway `languageModel(id)`.
 */
export function resolveModel(model: ModelInput, options: ResolveModelOptions = {}): LanguageModel {
  if (typeof model !== "string") return model;
  const gw =
    options.gateway ??
    createGateway({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
  return gw.languageModel(model as Parameters<GatewayProvider["languageModel"]>[0]);
}

/**
 * Convenience: resolve straight from an `AgentDefinition`, so a host can do
 * `resolveAgentModel(defineAgent({ model: "anthropic/claude-sonnet-4-5" }))`.
 */
export function resolveAgentModel(definition: AgentDefinition, options: ResolveModelOptions = {}): LanguageModel {
  return resolveModel(definition.model as ModelInput, options);
}
