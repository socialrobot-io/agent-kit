import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import type { CuratorModelRunner } from "@socialrobot-io/agent-kit-curator";
import { InMemoryTranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import { createTenantHome, resetTenantHomeCache } from "./tenant-home.js";
import { createAgentKit } from "./agent-kit.js";
import { parseCuratorJob, waitForSessionCurators, type CuratorJob } from "./session-curator.js";
import type { StorageAdapter, TenantStorage } from "./storage.js";

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

/** In-memory adapter: one InMemoryFs and one transcript store per tenant. */
function memoryStorage(): StorageAdapter & { opened: Map<string, TenantStorage> } {
  const opened = new Map<string, TenantStorage>();
  return {
    opened,
    key: (tenantId) => `memory:${tenantId}`,
    async open(tenantId) {
      let storage = opened.get(tenantId);
      if (!storage) {
        storage = {
          volume: new InMemoryFs(),
          transcripts: new InMemoryTranscriptStore(),
          location: `memory:${tenantId}`,
        };
        opened.set(tenantId, storage);
      }
      return storage;
    },
  };
}

/** Curator runner that always saves one memory entry. */
function savingRunner(content: string): CuratorModelRunner {
  return async () => ({
    text: "Saved.",
    toolCalls: [{ name: "memory", args: { action: "add", target: "user", content } }],
  });
}

const autoApprove = defineAgent({
  model: "mock/model",
  config: { curator: { mode: "memory", autoApprove: true } },
});

describe("storage adapters", () => {
  it("opens a home on a custom adapter with its transcript store", async () => {
    const storage = memoryStorage();
    const home = await createTenantHome({
      tenantId: "t1",
      storage,
      model: mockModel(),
      sandbox: false,
    });

    expect(home.location).toBe("memory:t1");
    expect(home.volumePath).toBe("memory:t1");
    expect(home.agentFs).toBeUndefined();
    expect(home.bash).toBeUndefined();
    expect(home.transcripts).toBe(storage.opened.get("t1")?.transcripts);

    await home.volume.writeFile("agent/SOUL.md", "You are brief.");
    const session = await home.openSession("chat-1");
    expect(session.builtinTools.map((t) => t.name)).toContain("session_search");
    expect(await home.transcripts!.listSessions("t1")).toHaveLength(1);
    expect((await session.run([{ role: "user", content: "Hi" }])).text).toBe("ok");
  });

  it("gives the sandbox an in-memory workspace when storage has no AgentFS", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      model: mockModel(),
      workspaceFiles: { "notes.txt": "hi\n" },
    });
    expect(home.bash?.persisted).toBe(false);
    const out = await home.bash!.tenantSandbox.executeCommand("cat /workspace/notes.txt");
    expect(out.stdout).toBe("hi\n");
  });

  it("keeps tenants apart on one adapter", async () => {
    const storage = memoryStorage();
    const a = await createTenantHome({
      tenantId: "a",
      storage,
      model: mockModel(),
      sandbox: false,
    });
    const b = await createTenantHome({
      tenantId: "b",
      storage,
      model: mockModel(),
      sandbox: false,
    });
    await a.volume.writeFile("memories/USER.md", "Likes tea\n");
    expect(await b.volume.readFile("memories/USER.md")).toBeNull();
  });

  it("rejects storage together with dataDir or volumePath", async () => {
    await expect(
      createTenantHome({ tenantId: "t1", storage: memoryStorage(), dataDir: "./x" }),
    ).rejects.toThrow(/not both/);
  });

  it("refuses a second tenant on the same AgentFS volumePath", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-storage-"));
    try {
      const volumePath = join(dir, "one.db");
      await createTenantHome({ tenantId: "a", volumePath, model: mockModel(), sandbox: false });
      await expect(
        createTenantHome({ tenantId: "b", volumePath, model: mockModel(), sandbox: false }),
      ).rejects.toThrow(/already open for tenant 'a'/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("home.stores", () => {
  it("returns loaded memory that host code can list and edit", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      model: mockModel(),
      sandbox: false,
    });
    await home.volume.writeFile("memories/USER.md", "Prefers short posts\n");
    const { memory } = await home.stores();
    expect(memory.getEntries("user")).toEqual(["Prefers short posts"]);
    await memory.remove("user", "short posts");
    expect((await home.stores()).memory.getEntries("user")).toEqual([]);
  });
});

describe("curator queue", () => {
  it("hands a job to curatorQueue instead of reviewing in process", async () => {
    const jobs: CuratorJob[] = [];
    let reviewed = 0;
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      model: mockModel("Hello"),
      sandbox: false,
      curatorQueue: (job) => {
        jobs.push(job);
      },
      curatorRunner: async () => {
        reviewed++;
        return { text: "", toolCalls: [] };
      },
    });
    const session = await home.openSession("chat-1");
    await session.run([{ role: "user", content: "Call me Sam." }]);
    await waitForSessionCurators();

    expect(reviewed).toBe(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      v: 1,
      tenantId: "t1",
      sessionId: "chat-1",
      conversation: [
        { role: "user", content: "Call me Sam." },
        { role: "assistant", content: "Hello" },
      ],
    });
    // Survives a round trip through a JSON queue.
    expect(parseCuratorJob(JSON.parse(JSON.stringify(jobs[0])))).toEqual(jobs[0]);
  });

  it("never rejects the turn when the queue throws", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      model: mockModel(),
      sandbox: false,
      curatorQueue: () => {
        throw new Error("redis down");
      },
    });
    const session = await home.openSession("chat-1");
    await expect(session.run([{ role: "user", content: "Hi" }])).resolves.toBeTruthy();
    await waitForSessionCurators();
  });
});

describe("recordTurn", () => {
  it("saves the turn and queues one review from the same text", async () => {
    const jobs: CuratorJob[] = [];
    const storage = memoryStorage();
    const home = await createTenantHome({
      tenantId: "t1",
      storage,
      definition: autoApprove,
      model: mockModel("Here is your draft."),
      sandbox: false,
      curatorQueue: (job) => {
        jobs.push(job);
      },
    });
    const session = await home.openSession("chat-1", { autoReview: false });
    await session.run([{ role: "user", content: "Write a launch post." }]);
    await waitForSessionCurators();
    expect(jobs).toHaveLength(0);

    const result = await home.recordTurn("chat-1", {
      context: [{ role: "user", content: "We sell tea." }],
      messages: [
        { id: "m1", role: "user", content: "Write a launch post." },
        { id: "m2", role: "assistant", content: "Draft: Our new tea is here." },
        { id: "m3", role: "assistant", content: "  " },
      ],
    });

    expect(result).toEqual({ recorded: 2, review: "queued" });
    expect((await home.transcripts!.scroll("chat-1")).map((m) => m.content)).toEqual([
      "Write a launch post.",
      "Draft: Our new tea is here.",
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      tenantId: "t1",
      sessionId: "chat-1",
      conversation: [
        { role: "user", content: "We sell tea." },
        { role: "user", content: "Write a launch post." },
        { role: "assistant", content: "Draft: Our new tea is here." },
      ],
    });
  });

  it("does not save a message id twice", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
    });
    const turn = { messages: [{ id: "m1", role: "user" as const, content: "Hi" }], review: false };
    expect(await home.recordTurn("chat-1", turn)).toEqual({ recorded: 1, review: "skipped" });
    await home.recordTurn("chat-1", turn);
    expect(await home.transcripts!.scroll("chat-1")).toHaveLength(1);
  });

  it("reviews in process when there is no queue", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("Sells tea"),
    });
    const result = await home.recordTurn("chat-1", {
      messages: [{ id: "m1", role: "user", content: "We sell tea." }],
    });
    expect(result.review).toBe("started");
    await waitForSessionCurators();
    expect((await home.stores()).memory.getEntries("user")).toEqual(["Sells tea"]);
  });

  it("skips the review when the turn has no new text", async () => {
    const jobs: CuratorJob[] = [];
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
      curatorQueue: (job) => {
        jobs.push(job);
      },
    });
    const result = await home.recordTurn("chat-1", {
      context: [{ role: "user", content: "Earlier" }],
      messages: [{ id: "m1", role: "assistant", content: " " }],
    });
    expect(result).toEqual({ recorded: 0, review: "skipped" });
    expect(jobs).toHaveLength(0);
  });

  it("skips the review when the curator is off", async () => {
    const jobs: CuratorJob[] = [];
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: defineAgent({ model: "mock/model", config: { curator: false } }),
      sandbox: false,
      curatorQueue: (job) => {
        jobs.push(job);
      },
    });
    const result = await home.recordTurn("chat-1", {
      messages: [{ id: "m1", role: "user", content: "Hi" }],
    });
    expect(result).toEqual({ recorded: 1, review: "skipped" });
    expect(jobs).toHaveLength(0);
  });

  it("rejects when the queue throws, so the host can report it", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
      curatorQueue: () => {
        throw new Error("redis down");
      },
    });
    await expect(
      home.recordTurn("chat-1", { messages: [{ id: "m1", role: "user", content: "Hi" }] }),
    ).rejects.toThrow(/redis down/);
  });

  it("kit.recordTurn saves to the tenant's own transcripts", async () => {
    const storage = memoryStorage();
    const kit = createAgentKit({ storage, definition: autoApprove, sandbox: false });
    await kit.recordTurn("t2", "chat-1", {
      messages: [{ id: "m1", role: "user", content: "Hi" }],
      review: false,
    });
    expect(await storage.opened.get("t2")?.transcripts?.scroll("chat-1")).toHaveLength(1);
    expect(storage.opened.has("t1")).toBe(false);
  });
});

describe("home.review and kit.review", () => {
  const job = (tenantId: string): CuratorJob => ({
    v: 1,
    tenantId,
    sessionId: "chat-1",
    conversation: [{ role: "user", content: "I am Sam and I hate emojis." }],
    createdAt: 1,
  });

  it("applies a review with the worker's agent policy", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("Hates emojis"),
    });
    const outcome = await home.review(job("t1"));
    expect(outcome?.applied).toHaveLength(1);
    expect((await home.stores()).memory.getEntries("user")).toEqual(["Hates emojis"]);
  });

  it("stages the review when the worker's policy has no autoApprove", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: defineAgent({ model: "mock/model", config: { curator: { mode: "memory" } } }),
      sandbox: false,
      curatorRunner: savingRunner("Hates emojis"),
    });
    const outcome = await home.review(job("t1"));
    expect(outcome?.staged).toHaveLength(1);
    expect((await home.stores()).memory.getEntries("user")).toEqual([]);
  });

  it("returns null when the curator is off", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: defineAgent({ model: "mock/model", config: { curator: false } }),
      sandbox: false,
      curatorRunner: savingRunner("x"),
    });
    expect(await home.review(job("t1"))).toBeNull();
  });

  it("refuses a job for another tenant", async () => {
    const home = await createTenantHome({
      tenantId: "t1",
      storage: memoryStorage(),
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("x"),
    });
    await expect(home.review(job("t2"))).rejects.toThrow(/tenant 't2'/);
  });

  it("kit.review opens the job's tenant home", async () => {
    const storage = memoryStorage();
    const kit = createAgentKit({
      storage,
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("Hates emojis"),
    });
    await kit.review(job("t2"));
    expect(await storage.opened.get("t2")?.volume.readFile("memories/USER.md")).toContain(
      "Hates emojis",
    );
    expect(storage.opened.has("t1")).toBe(false);
  });
});

describe("several kits in one process", () => {
  const job = (tenantId: string): CuratorJob => ({
    v: 1,
    tenantId,
    sessionId: "chat-1",
    conversation: [{ role: "user", content: "Hi" }],
    createdAt: 1,
  });

  it("keep their own options on shared storage", async () => {
    const storage = memoryStorage();
    const chat = createAgentKit({
      storage,
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("from chat kit"),
    });
    const worker = createAgentKit({
      storage,
      definition: autoApprove,
      sandbox: false,
      curatorRunner: savingRunner("from worker kit"),
    });
    await chat.home("t1");
    await worker.review(job("t1"));
    expect((await (await chat.home("t1")).stores()).memory.getEntries("user")).toEqual([
      "from worker kit",
    ]);
    expect(storage.opened.size).toBe(1);
  });

  it("share one file transcript store per AgentFS volume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-kits-"));
    try {
      const a = createAgentKit({ dataDir: dir, model: mockModel(), sandbox: false });
      const b = createAgentKit({ dataDir: dir, model: mockModel(), sandbox: false });
      const [homeA, homeB] = [await a.home("t1"), await b.home("t1")];
      expect(homeA).not.toBe(homeB);
      expect(homeA.transcripts).toBe(homeB.transcripts);
      expect(homeA.volume).toBe(homeB.volume);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("still refuse a second tenant on one volumePath", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-kits-"));
    try {
      const kit = createAgentKit({
        volumePath: join(dir, "one.db"),
        model: mockModel(),
        sandbox: false,
      });
      await kit.home("a");
      await expect(kit.home("b")).rejects.toThrow(/already open for tenant 'a'/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("parseCuratorJob", () => {
  it("rejects bad shapes from a queue", () => {
    expect(() => parseCuratorJob(null)).toThrow(/not an object/);
    expect(() => parseCuratorJob({ v: 2 })).toThrow(/version/);
    expect(() =>
      parseCuratorJob({ v: 1, tenantId: "t", sessionId: "s", conversation: [{ role: "x" }] }),
    ).toThrow(/bad message/);
    expect(() => parseCuratorJob({ v: 1, tenantId: "", sessionId: "s", conversation: [] })).toThrow(
      /tenantId/,
    );
  });
});
