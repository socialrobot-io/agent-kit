import { describe, it, expect } from "vitest";
import {
  buildToolGuidance,
  MEMORY_GUIDANCE,
  SKILLS_GUIDANCE,
  SESSION_SEARCH_GUIDANCE,
  SANDBOX_GUIDANCE,
} from "./tool-guidance.js";

describe("buildToolGuidance", () => {
  it("includes memory + skills for the default runtime surface", () => {
    const text = buildToolGuidance(["memory", "skills_list", "skill_view", "skill_manage"]);
    expect(text).toContain(MEMORY_GUIDANCE);
    expect(text).toContain(SKILLS_GUIDANCE);
    expect(text).not.toContain(SESSION_SEARCH_GUIDANCE);
    expect(text).not.toContain(SANDBOX_GUIDANCE);
  });

  it("adds session_search and sandbox only when those tools are present", () => {
    const text = buildToolGuidance([
      "memory",
      "skills_list",
      "session_search",
      "bash",
      "readFile",
      "writeFile",
    ]);
    expect(text).toContain(SESSION_SEARCH_GUIDANCE);
    expect(text).toContain(SANDBOX_GUIDANCE);
  });

  it("session_search guidance steers browse / skip-current / no invention", () => {
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/browse/i);
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/current/i);
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/Do not invent/i);
  });

  it("memory guidance forbids claiming staged writes as saved", () => {
    expect(MEMORY_GUIDANCE).toMatch(/staged:true/i);
    expect(MEMORY_GUIDANCE).toMatch(/pending approval/i);
  });

  it("returns empty when fully disabled", () => {
    expect(buildToolGuidance(["memory", "session_search"], false)).toBe("");
  });

  it("allows per-key opt-out", () => {
    const text = buildToolGuidance(["memory", "session_search", "bash"], {
      memory: false,
      session_search: true,
    });
    expect(text).not.toContain(MEMORY_GUIDANCE);
    expect(text).toContain(SESSION_SEARCH_GUIDANCE);
    expect(text).toContain(SANDBOX_GUIDANCE);
  });

  it("returns empty when no matched tools are present", () => {
    expect(buildToolGuidance(["weather"])).toBe("");
  });
});
