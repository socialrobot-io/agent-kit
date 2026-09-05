import { describe, it, expect } from "vitest";
import {
  buildToolGuidance,
  MEMORY_GUIDANCE,
  MEMORY_GUIDANCE_BASE,
  MEMORY_WRITE_APPROVAL_GUIDANCE,
  SKILLS_GUIDANCE,
  SKILLS_GUIDANCE_BASE,
  SKILLS_WRITE_APPROVAL_GUIDANCE,
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

  it("memory guidance forbids claiming staged writes as saved when the gate is on", () => {
    expect(MEMORY_GUIDANCE).toMatch(/staged:true/i);
    expect(MEMORY_GUIDANCE).toMatch(/pending approval/i);
    expect(MEMORY_GUIDANCE).toContain(MEMORY_WRITE_APPROVAL_GUIDANCE);
    expect(SKILLS_GUIDANCE).toContain(SKILLS_WRITE_APPROVAL_GUIDANCE);
  });

  it("drops pending-approval copy when writeApproval is off", () => {
    const text = buildToolGuidance(
      ["memory", "skills_list", "skill_view", "skill_manage"],
      true,
      { memory: false, skills: false },
    );
    expect(text).toContain(MEMORY_GUIDANCE_BASE);
    expect(text).toContain(SKILLS_GUIDANCE_BASE);
    expect(text).not.toMatch(/staged:true/i);
    expect(text).not.toMatch(/pending approval/i);
    expect(text).not.toContain(MEMORY_WRITE_APPROVAL_GUIDANCE);
    expect(text).not.toContain(SKILLS_WRITE_APPROVAL_GUIDANCE);
  });

  it("can drop pending copy for one subsystem only", () => {
    const text = buildToolGuidance(["memory", "skill_manage"], true, {
      memory: false,
      skills: true,
    });
    expect(text).toContain(MEMORY_GUIDANCE_BASE);
    expect(text).not.toContain(MEMORY_WRITE_APPROVAL_GUIDANCE);
    expect(text).toContain(SKILLS_WRITE_APPROVAL_GUIDANCE);
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
