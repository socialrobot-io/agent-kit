import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";
import { AGENT_BUNDLE_MANIFEST, installAgent, type AgentBundle } from "./seed-company.js";
import { loadSkillLocks } from "./skill-locks.js";
import { SkillLibrary } from "./skills.js";

const skillMd = (name: string, locked = true) =>
  `---\nname: ${name}\ndescription: The ${name} skill.\n${locked ? "locked: true\n" : ""}---\n\n# ${name}\n`;

const v1: AgentBundle = {
  soul: "You write posts.",
  agentsMd: "Be brief.",
  skills: [
    { name: "threads", files: { "SKILL.md": skillMd("threads"), "references/hooks.md": "Hooks v1\n" } },
    { name: "captions", files: { "SKILL.md": skillMd("captions") } },
  ],
};

const manifestPath = `agent/${AGENT_BUNDLE_MANIFEST}`;

describe("installAgent prune", () => {
  it("removes a skill the bundle dropped, unlocks it, and keeps learned skills and memory", async () => {
    const fs = new InMemoryFs();
    await installAgent(fs, v1, { prune: true });
    await fs.writeFile("skills/learned-tone/SKILL.md", skillMd("learned-tone", false));
    await fs.writeFile("memories/MEMORY.md", "Posts end with a question.");
    expect(await loadSkillLocks(fs)).toEqual(new Set(["threads", "captions"]));

    const result = await installAgent(fs, { ...v1, skills: [v1.skills![0]!] }, { prune: true });

    expect(result.removed).toEqual(["skills/captions/SKILL.md"]);
    expect(await fs.readFile("skills/captions/SKILL.md")).toBeNull();
    expect(await loadSkillLocks(fs)).toEqual(new Set(["threads"]));
    const names = (await new SkillLibrary(fs).list()).map((s) => s.name).sort();
    expect(names).toEqual(["learned-tone", "threads"]);
    expect(await fs.readFile("memories/MEMORY.md")).toBe("Posts end with a question.");
  });

  it("removes a file dropped from a skill it keeps, and a dropped SOUL.md", async () => {
    const fs = new InMemoryFs();
    await installAgent(fs, v1, { prune: true });
    const renamed: AgentBundle = {
      agentsMd: v1.agentsMd,
      skills: [
        { name: "threads", files: { "SKILL.md": skillMd("threads"), "references/openers.md": "Hooks v2\n" } },
        v1.skills![1]!,
      ],
    };

    const result = await installAgent(fs, renamed, { prune: true });

    expect(result.removed.sort()).toEqual(["agent/SOUL.md", "skills/threads/references/hooks.md"]);
    expect(await fs.readFile("skills/threads/references/openers.md")).toBe("Hooks v2\n");
    expect(await loadSkillLocks(fs)).toEqual(new Set(["threads", "captions"]));
  });

  it("removes nothing on the first pruning install, then records what it wrote", async () => {
    const fs = new InMemoryFs();
    await installAgent(fs, v1);
    expect(await fs.readFile(manifestPath)).toBeNull();

    const result = await installAgent(fs, { soul: v1.soul }, { prune: true });

    expect(result.removed).toEqual([]);
    expect(await fs.readFile("skills/threads/SKILL.md")).not.toBeNull();
    expect(JSON.parse((await fs.readFile(manifestPath))!)).toEqual({ files: ["agent/SOUL.md"] });
  });

  it("does not prune without the option", async () => {
    const fs = new InMemoryFs();
    await installAgent(fs, v1, { prune: true });
    const result = await installAgent(fs, { soul: v1.soul });
    expect(result.removed).toEqual([]);
    expect(await fs.readFile("skills/captions/SKILL.md")).not.toBeNull();
  });

  it("never deletes outside the agent and skill directories", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("memories/USER.md", "Never use emojis.");
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ files: ["memories/USER.md", "skills/.locks.json", "../escape.md"] }),
    );

    const result = await installAgent(fs, { soul: v1.soul }, { prune: true });

    expect(result.removed).toEqual([]);
    expect(await fs.readFile("memories/USER.md")).toBe("Never use emojis.");
  });

  it("keeps a path whose delete failed, and removes it on the next install", async () => {
    const fs = new InMemoryFs();
    await installAgent(fs, v1, { prune: true });
    const flaky = Object.assign(Object.create(fs) as InMemoryFs, {
      deleteFile: async () => {
        throw new Error("database busy");
      },
    });
    const smaller: AgentBundle = { ...v1, skills: [v1.skills![0]!] };

    expect((await installAgent(flaky, smaller, { prune: true })).removed).toEqual([]);
    expect(JSON.parse((await fs.readFile(manifestPath))!).files).toContain("skills/captions/SKILL.md");

    expect((await installAgent(fs, smaller, { prune: true })).removed).toEqual(["skills/captions/SKILL.md"]);
    expect(JSON.parse((await fs.readFile(manifestPath))!).files).not.toContain("skills/captions/SKILL.md");
  });
});
