import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFs, installAgent, SkillLibrary, createAgentFs } from "@socialrobot-io/agent-kit-core";
import { compileAgent, loadAgent } from "./compile-agent.js";

describe("compileAgent", () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function writeAgentTree(): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "agent-kit-compile-"));
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "skills", "notes"), { recursive: true });
    await writeFile(join(agentDir, "SOUL.md"), "You are concise.\n", "utf8");
    await writeFile(
      join(agentDir, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Unlocked notes skill.\n---\n\n# Notes\n",
      "utf8",
    );
    return agentDir;
  }

  it("loads agent/ into a bundle", async () => {
    const dir = await writeAgentTree();
    const bundle = await loadAgent(dir);
    expect(bundle.soul).toBe("You are concise.\n");
    expect(bundle.skills?.map((s) => s.name)).toEqual(["notes"]);
    expect(bundle.skills?.[0]?.tier).toBe("agent");
  });

  it("writes a TypeScript module hosts can import", async () => {
    const dir = await writeAgentTree();
    const outFile = join(root, "generated", "agent.ts");
    const bundle = await compileAgent({ dir, outFile });
    expect(bundle).toEqual(await loadAgent(dir));

    const ts = await readFile(outFile, "utf8");
    expect(ts).toContain("compileAgent");
    expect(ts).toContain("export const agent");
    expect(ts).toContain("You are concise.");

    const volume = new InMemoryFs();
    await installAgent(volume, bundle);
    expect(await volume.readFile("agent/SOUL.md")).toBe("You are concise.\n");
    const skills = new SkillLibrary(createAgentFs(volume));
    expect(await skills.isLocked("notes")).toBe(false);
  });
});
