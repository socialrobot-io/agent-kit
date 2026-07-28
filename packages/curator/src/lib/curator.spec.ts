import { describe, it, expect, beforeEach } from "vitest";
import {
  runBackgroundReview,
  MEMORY_REVIEW_PROMPT,
  SKILL_REVIEW_PROMPT,
  COMBINED_REVIEW_PROMPT,
  type CuratorModelRunner,
} from "./curator.js";
import { MemoryStore, SkillLibrary, PendingWriteStore, InMemoryFs } from "@agent-kit/core";

const conversation = [
  { role: "user" as const, content: "Stop being so verbose. Just give me the answer." },
  { role: "assistant" as const, content: "Understood, I'll be concise." },
];

function makeModel(calls: { name: string; args: Record<string, unknown> }[]): CuratorModelRunner {
  return async () => ({ text: "Reviewed.", toolCalls: calls });
}

describe("curator prompts", () => {
  it("exposes Hermes-compatible review prompts", () => {
    expect(MEMORY_REVIEW_PROMPT).toContain("saving to memory");
    expect(SKILL_REVIEW_PROMPT).toContain("skill library");
    expect(COMBINED_REVIEW_PROMPT).toContain("**Memory**");
    expect(COMBINED_REVIEW_PROMPT).toContain("**Skills**");
  });
});

describe("runBackgroundReview", () => {
  let fs: InMemoryFs;
  let memory: MemoryStore;
  let skills: SkillLibrary;
  let pending: PendingWriteStore;

  beforeEach(async () => {
    fs = new InMemoryFs();
    memory = new MemoryStore(fs);
    await memory.loadFromDisk();
    skills = new SkillLibrary(fs);
    pending = new PendingWriteStore(fs);
  });

  it("applies memory writes directly when the gate is off", async () => {
    const outcome = await runBackgroundReview(conversation, {
      memory,
      skills,
      pending,
      writeApprovalEnabled: () => false,
      model: makeModel([{ name: "memory", args: { action: "add", target: "user", content: "User wants concise answers" } }]),
    });
    expect(outcome.applied).toHaveLength(1);
    expect(memory.getEntries("user")).toContain("User wants concise answers");
    expect(await pending.count("memory")).toBe(0);
  });

  it("stages memory writes when the gate is on (background origin)", async () => {
    const outcome = await runBackgroundReview(conversation, {
      memory,
      skills,
      pending,
      writeApprovalEnabled: () => true,
      model: makeModel([{ name: "memory", args: { action: "add", target: "user", content: "User wants concise answers" } }]),
    });
    expect(outcome.staged).toHaveLength(1);
    expect(memory.getEntries("user")).toHaveLength(0);
    expect(await pending.count("memory")).toBe(1);
  });

  it("stages skill writes when the gate is on", async () => {
    const outcome = await runBackgroundReview(conversation, {
      memory,
      skills,
      pending,
      writeApprovalEnabled: () => true,
      model: makeModel([
        { name: "skill_manage", args: { action: "create", name: "concise-answers", content: "---\ndescription: Be concise\n---\nBe concise." } },
      ]),
    });
    expect(outcome.staged).toHaveLength(1);
    expect(await pending.count("skills")).toBe(1);
    expect((await skills.list())).toHaveLength(0);
  });

  it("creates a skill directly when the gate is off", async () => {
    const outcome = await runBackgroundReview(conversation, {
      memory,
      skills,
      pending,
      writeApprovalEnabled: () => false,
      model: makeModel([
        { name: "skill_manage", args: { action: "create", name: "concise-answers", content: "---\ndescription: Be concise\n---\nBe concise." } },
      ]),
    });
    expect(outcome.applied).toHaveLength(1);
    expect((await skills.list()).map((s) => s.name)).toContain("concise-answers");
  });

  it("collects errors without throwing", async () => {
    const outcome = await runBackgroundReview(conversation, {
      memory,
      skills,
      pending,
      writeApprovalEnabled: () => false,
      model: makeModel([{ name: "skill_manage", args: { action: "delete", name: "missing" } }]),
    });
    // delete of a missing skill returns a non-success result, not an exception
    expect(outcome.applied).toHaveLength(1); // applied path returns the result
  });
});
