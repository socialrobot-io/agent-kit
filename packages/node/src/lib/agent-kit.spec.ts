import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { loadAgent } from "./compile-agent.js";
import { createAgentKit } from "./agent-kit.js";
import { waitForSessionCurators } from "./session-curator.js";

afterEach(async () => {
  await waitForSessionCurators();
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

const base = { sandbox: false, transcripts: false } as const;

describe("createAgentKit (stateless by default)", () => {
  it("opens a fresh session each call (no caching)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-stateless-"));
    try {
      const kit = createAgentKit({ dataDir: dir, model: mockModel(), ...base });

      const a = await kit.session("t1", "c1");
      const b = await kit.session("t1", "c1");
      expect(a).not.toBe(b);
      expect(kit.openSessions("t1")).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("boots one home per tenant and reuses it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-home-"));
    try {
      const kit = createAgentKit({ dataDir: dir, model: mockModel(), ...base });

      const homeA = await kit.home("t1");
      const homeB = await kit.home("t1");
      expect(homeA).toBe(homeB);

      const homeOther = await kit.home("t2");
      expect(homeOther).not.toBe(homeA);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs a turn end to end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-run-"));
    try {
      const kit = createAgentKit({ dataDir: dir, model: mockModel("hello"), ...base });

      const session = await kit.session("t1", "c1");
      const turn = await session.run([{ role: "user", content: "Hi" }]);
      expect(turn.text).toBe("hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("installs the agent on every tenant home", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-agent-"));
    const agentDir = join(dir, "agent");
    try {
      await mkdir(join(agentDir, "skills", "notes"), { recursive: true });
      await writeFile(join(agentDir, "SOUL.md"), "You are company bot.\n", "utf8");
      await writeFile(join(agentDir, "AGENTS.md"), "Be brief.\n", "utf8");
      await writeFile(
        join(agentDir, "skills", "notes", "SKILL.md"),
        "---\nname: notes\ndescription: Notes.\n---\n\n# Notes\n",
        "utf8",
      );

      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        agent: await loadAgent(agentDir),
      });

      const session = await kit.session("brand-1", "chat-1");
      expect(session.runtime.systemPrompt()).toContain("You are company bot.");
      const other = await kit.session("brand-2", "chat-1");
      expect(other.runtime.systemPrompt()).toContain("You are company bot.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("onBeforeSession fires on every call in stateless mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-hook-stateless-"));
    try {
      const calls: string[] = [];
      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        onBeforeSession: async (_home, tenantId, sessionId) => {
          calls.push(`${tenantId}/${sessionId}`);
        },
      });

      await kit.session("t1", "c1");
      await kit.session("t1", "c1"); // stateless: hook fires again
      await kit.session("t2", "c1");
      expect(calls).toEqual(["t1/c1", "t1/c1", "t2/c1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("createAgentKit (opt-in cache via maxSessions)", () => {
  it("reuses the same session handle for the same chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-cached-"));
    try {
      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        maxSessions: 32,
      });

      const a = await kit.session("t1", "c1");
      const b = await kit.session("t1", "c1");
      expect(a).toBe(b);

      const c = await kit.session("t1", "c2");
      expect(c).not.toBe(a);

      const d = await kit.session("t2", "c1");
      expect(d).not.toBe(a);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("evicts the oldest session when maxSessions is exceeded (LRU)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-lru-"));
    try {
      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        maxSessions: 2,
      });

      const s1 = await kit.session("t1", "c1");
      const s2 = await kit.session("t1", "c2");
      // Touch c1 so c2 becomes the oldest.
      expect(await kit.session("t1", "c1")).toBe(s1);
      // Opening c3 exceeds the cap; c2 (oldest) should be evicted.
      const s3 = await kit.session("t1", "c3");
      expect(s3).not.toBe(s2);
      // c1 is still cached (recently used); c2 is gone.
      expect(await kit.session("t1", "c1")).toBe(s1);
      // c2 was evicted, so reopening yields a new handle.
      const s2Again = await kit.session("t1", "c2");
      expect(s2Again).not.toBe(s2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("onBeforeSession fires only on cache miss when cached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-hook-cached-"));
    try {
      const calls: string[] = [];
      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        maxSessions: 32,
        onBeforeSession: async (_home, tenantId, sessionId) => {
          calls.push(`${tenantId}/${sessionId}`);
        },
      });

      await kit.session("t1", "c1");
      await kit.session("t1", "c1"); // cache hit — hook must not fire
      await kit.session("t2", "c1");
      expect(calls).toEqual(["t1/c1", "t2/c1"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("openSessions lists cached session ids per tenant", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-open-"));
    try {
      const kit = createAgentKit({
        dataDir: dir,
        model: mockModel(),
        ...base,
        maxSessions: 32,
      });

      expect(kit.openSessions("t1")).toEqual([]);
      await kit.session("t1", "c1");
      await kit.session("t1", "c2");
      await kit.session("t2", "c1");
      expect(kit.openSessions("t1").sort()).toEqual(["c1", "c2"]);
      expect(kit.openSessions("t2")).toEqual(["c1"]);
      kit.closeSession("t1", "c1");
      expect(kit.openSessions("t1")).toEqual(["c2"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
