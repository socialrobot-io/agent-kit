/**
 * Adapt agent-kit `SessionTool`s (memory, skills_list, skill_view, skill_manage,
 * plus any host tools) into an AI SDK `ToolSet` for `generateText`/`streamText`.
 */

import { jsonSchema, type ToolSet, type JSONSchema7 } from "ai";
import type { SessionTool } from "@agent-kit/core";

/** A JSON Schema object for a tool with untyped (passthrough) args. */
const ANY_OBJECT: JSONSchema7 = { type: "object", additionalProperties: true };

function toJsonSchema(schema: Record<string, unknown> | undefined): JSONSchema7 {
  if (schema && Object.keys(schema).length > 0) return schema as JSONSchema7;
  return ANY_OBJECT;
}

/**
 * Convert an array of agent-kit tools into an AI SDK `ToolSet` keyed by name.
 * Each tool's `execute` is awaited and its result returned to the model.
 */
export function toAiTools(tools: SessionTool[]): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = {
      description: t.description,
      inputSchema: jsonSchema(toJsonSchema(t.inputSchema)),
      execute: async (args: unknown) => t.execute((args ?? {}) as Record<string, unknown>),
    } as ToolSet[string];
  }
  return set;
}
