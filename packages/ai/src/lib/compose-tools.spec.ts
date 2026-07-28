/**
 * Compose agent tools — unit tests.
 */

import { describe, it, expect } from "vitest";
import { composeAgentTools } from "./compose-tools.js";
import type { SessionTool } from "@agent-kit/core";

const memory: SessionTool = {
  name: "memory",
  description: "m",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({}),
};
const search: SessionTool = {
  name: "session_search",
  description: "s",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({}),
};
const weather: SessionTool = {
  name: "weather",
  description: "w",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({}),
};

describe("composeAgentTools", () => {
  it("includes builtins by default", () => {
    const { sessionTools } = composeAgentTools({ builtins: [memory, search] });
    expect(sessionTools.map((t) => t.name)).toEqual(["memory", "session_search"]);
  });

  it("addTools appends and can override by name", () => {
    const { sessionTools } = composeAgentTools({
      builtins: [memory],
      addTools: [weather, { ...memory, description: "override" }],
    });
    expect(sessionTools.map((t) => t.name).sort()).toEqual(["memory", "weather"]);
    expect(sessionTools.find((t) => t.name === "memory")!.description).toBe("override");
  });

  it("disableTools removes by name", () => {
    const { sessionTools } = composeAgentTools({
      builtins: [memory, search],
      disableTools: ["memory"],
    });
    expect(sessionTools.map((t) => t.name)).toEqual(["session_search"]);
  });

  it("tools replaces the full list", () => {
    const { sessionTools } = composeAgentTools({
      builtins: [memory, search],
      tools: [weather],
    });
    expect(sessionTools.map((t) => t.name)).toEqual(["weather"]);
  });
});
