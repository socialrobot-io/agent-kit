import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { createTenantHome, resetTenantHomeCache } from "./tenant-home.js";

afterEach(() => {
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
});
