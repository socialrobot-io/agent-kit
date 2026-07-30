import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { loadAgent } from "./compile-agent.js";
import { createTenantHome, resetTenantHomeCache } from "./tenant-home.js";
import { waitForSessionCurators } from "./session-curator.js";

afterEach(async () => {
  await waitForSessionCurators();
  resetTenantHomeCache();
});

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function mockModel(text = "ok"): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: USAGE,
        warnings: [],
      };
    },
    async doStream() {
      throw new Error("no stream");
    },
  } as unknown as LanguageModel;
}

describe("createTenantHome", () => {
  it("opens volume, transcripts, sandbox by convention", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-home-"));
    try {
      const home = await createTenantHome({
        tenantId: "brand-123",
        dataDir: dir,
        model: mockModel(),
        workspaceFiles: { "README.md": "# hi\n" },
      });

      expect(home.volumePath).toBe(join(dir, "tenants", "brand-123.db"));
      expect(home.transcripts).toBeTruthy();
      expect(home.bash?.persisted).toBe(true);

      await home.volume.writeFile("agent/SOUL.md", "You are brief.");
      const session = await home.openSession("chat-1");
      expect(session.tenantId).toBe("brand-123");
      expect(session.memory).toBe(session.runtime.memory);
      expect(session.builtinTools.map((t) => t.name)).toContain("session_search");
      expect(session.sandboxTools?.bash).toBeTruthy();

      const turn = await session.run([{ role: "user", content: "Hi" }]);
      expect(turn.text).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("single-flights the same volume path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-home-"));
    try {
      const a = createTenantHome({ tenantId: "t1", dataDir: dir, model: mockModel(), sandbox: false });
      const b = createTenantHome({ tenantId: "t1", dataDir: dir, model: mockModel(), sandbox: false });
      expect(await a).toBe(await b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows opting out of sandbox and transcripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-home-"));
    try {
      const home = await createTenantHome({
        tenantId: "t1",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
      });
      expect(home.bash).toBeUndefined();
      expect(home.transcripts).toBeUndefined();
      const session = await home.openSession("c1");
      expect(session.builtinTools.map((t) => t.name)).not.toContain("session_search");
      expect(session.sandboxTools).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("installs a compiled agent on boot; locked skills stay immutable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-home-"));
    const agentDir = join(dir, "agent");
    try {
      await mkdir(join(agentDir, "skills", "team-notes"), { recursive: true });
      await mkdir(join(agentDir, "skills", "billing-api"), { recursive: true });
      await writeFile(join(agentDir, "SOUL.md"), "You are company bot.\n", "utf8");
      await writeFile(join(agentDir, "AGENTS.md"), "Be brief.\n", "utf8");
      await writeFile(
        join(agentDir, "skills", "team-notes", "SKILL.md"),
        "---\nname: team-notes\ndescription: Unlocked agent-folder skill.\n---\n\n# Notes\n",
        "utf8",
      );
      await writeFile(
        join(agentDir, "skills", "billing-api", "SKILL.md"),
        "---\nname: billing-api\ndescription: Locked agent skill.\nlocked: true\n---\n\n# Billing\n",
        "utf8",
      );

      const home = await createTenantHome({
        tenantId: "brand-env",
        dataDir: dir,
        model: mockModel(),
        sandbox: false,
        transcripts: false,
        agent: await loadAgent(agentDir),
      });

      const session = await home.openSession("chat-1");
      expect(session.runtime.systemPrompt()).toContain("You are company bot.");
      expect(await session.skills.isLocked("billing-api")).toBe(true);
      expect(await session.skills.isLocked("team-notes")).toBe(false);

      const toolResult = (await session.runtime
        .tools()
        .find((t) => t.name === "skill_manage")!
        .execute({
          action: "delete",
          name: "billing-api",
        })) as { success?: boolean; error?: string };
      expect(toolResult.success).toBe(false);
      expect(toolResult.error).toMatch(/locked/i);
      expect((await session.skills.view("billing-api")).success).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
