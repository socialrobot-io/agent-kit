import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryFs, installAgent, SkillLibrary, createAgentFs } from "@socialrobot-io/agent-kit-core";
import {
  AGENT_KIT_AGENTS_DIR_ENV,
  compileAgent,
  loadAgent,
  resolveAgentPath,
} from "./compile-agent.js";

describe("compileAgent", () => {
  let root: string;
  let prevCwd: string;
  let savedAgentsDir: string | undefined;
  let didTouchAgentsDir = false;

  afterEach(async () => {
    if (prevCwd) process.chdir(prevCwd);
    if (didTouchAgentsDir) {
      if (savedAgentsDir === undefined) delete process.env[AGENT_KIT_AGENTS_DIR_ENV];
      else process.env[AGENT_KIT_AGENTS_DIR_ENV] = savedAgentsDir;
      didTouchAgentsDir = false;
    }
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function writeAgentTree(name = "agent"): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "agent-kit-compile-"));
    const agentDir = join(root, name);
    await mkdir(join(agentDir, "skills", "notes"), { recursive: true });
    await writeFile(join(agentDir, "SOUL.md"), "You are concise.\n", "utf8");
    await writeFile(
      join(agentDir, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Unlocked notes skill.\n---\n\n# Notes\n",
      "utf8",
    );
    return agentDir;
  }

  it("loads an absolute agent path into a bundle", async () => {
    const dir = await writeAgentTree();
    const bundle = await loadAgent(dir);
    expect(bundle.soul).toBe("You are concise.\n");
    expect(bundle.skills?.map((s) => s.name)).toEqual(["notes"]);
    expect(bundle.skills?.[0]?.tier).toBe("agent");
  });

  it("loads a bare agent name under agents/", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-kit-compile-rel-"));
    const agentDir = join(root, "agents", "chat");
    await mkdir(join(agentDir, "skills", "notes"), { recursive: true });
    await writeFile(join(agentDir, "SOUL.md"), "Relative load.\n", "utf8");
    await writeFile(
      join(agentDir, "skills", "notes", "SKILL.md"),
      "---\nname: notes\ndescription: Notes.\n---\n\n# Notes\n",
      "utf8",
    );
    prevCwd = process.cwd();
    process.chdir(root);
    const bundle = await loadAgent("chat");
    expect(bundle.soul).toBe("Relative load.\n");
    expect(bundle.skills?.map((s) => s.name)).toEqual(["notes"]);
  });

  it("honors AGENT_KIT_AGENTS_DIR for bare names", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-kit-compile-env-"));
    const agentDir = join(root, "src", "agents", "chat");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "SOUL.md"), "Env dir.\n", "utf8");
    prevCwd = process.cwd();
    savedAgentsDir = process.env[AGENT_KIT_AGENTS_DIR_ENV];
    didTouchAgentsDir = true;
    process.chdir(root);
    process.env[AGENT_KIT_AGENTS_DIR_ENV] = "src/agents";
    expect(resolveAgentPath("chat")).toBe(join(process.cwd(), "src", "agents", "chat"));
    const bundle = await loadAgent("chat");
    expect(bundle.soul).toBe("Env dir.\n");
  });

  it("still accepts an explicit relative path", async () => {
    root = await mkdtemp(join(tmpdir(), "agent-kit-compile-path-"));
    const agentDir = join(root, "custom", "bot");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "SOUL.md"), "Path load.\n", "utf8");
    prevCwd = process.cwd();
    process.chdir(root);
    expect(await loadAgent("custom/bot")).toMatchObject({ soul: "Path load.\n" });
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
