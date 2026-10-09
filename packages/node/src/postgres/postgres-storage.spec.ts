import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { LanguageModel } from "ai";
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { createAgentKit } from "../lib/agent-kit.js";
import { createTenantHome, resetTenantHomeCache } from "../lib/tenant-home.js";
import { waitForSessionCurators, type CuratorJob } from "../lib/session-curator.js";
import type { StorageAdapter } from "../lib/storage.js";
import type { SqlClient } from "./sql.js";
import { postgresStorage } from "./postgres-storage.js";
import { deletePostgresTenant, prunePostgresTranscripts } from "./maintenance.js";
import { backends, runId, type OpenBackend } from "../../tests/pg-backends.js";

afterEach(async () => {
  await waitForSessionCurators();
  resetTenantHomeCache();
});

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** Offline model: first a memory tool call, then a text reply. */
function rememberingModel(fact: string): LanguageModel {
  let step = 0;
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock",
    supportedUrls: {},
    async doGenerate() {
      step++;
      if (step % 2 === 1) {
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `c${step}`,
              toolName: "memory",
              input: JSON.stringify({
                action: "add",
                target: "user",
                content: fact,
              }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "Noted." }],
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

const agent = defineAgent({
  model: "mock/model",
  config: {
    writeApproval: { memory: false, skills: false },
    curator: { mode: "memory", autoApprove: true },
  },
});

describe.each(backends)("storage on $name", (backend) => {
  let open: OpenBackend;
  let db: SqlClient;
  let n = 0;
  const tenant = () => `st-${runId}-${++n}`;

  beforeAll(async () => {
    open = await backend.open();
    db = open.db;
  });

  afterAll(async () => {
    await open?.close();
  });

  describe("postgresStorage with createTenantHome", () => {
    it("matches the node StorageAdapter shape", () => {
      const adapter: StorageAdapter = postgresStorage({ db });
      expect(adapter.key("a")).not.toBe(adapter.key("b"));
    });

    it("runs a session whose memory lands in Postgres and shows in the next session", async () => {
      const tenantId = tenant();
      const home = await createTenantHome({
        tenantId,
        storage: postgresStorage({ db, ensureSchema: true }),
        definition: agent,
        model: rememberingModel("Never use emojis"),
        sandbox: false,
        curatorRunner: async () => ({ text: "", toolCalls: [] }),
      });
      expect(home.location).toBe(`postgres:agent_kit/${tenantId}`);
      await home.volume.writeFile("agent/SOUL.md", "You write social posts.");

      const first = await home.openSession("chat-1");
      const turn = await first.run([{ role: "user", content: "No emojis, ever." }]);
      expect(turn.text).toBe("Noted.");
      expect(await home.volume.readFile("memories/USER.md")).toContain("Never use emojis");

      const second = await home.openSession("chat-2");
      expect(second.runtime.systemPrompt()).toContain("You write social posts.");
      expect(second.runtime.systemPrompt()).toContain("Never use emojis");
      expect((await home.transcripts!.listSessions(tenantId)).map((s) => s.id).sort()).toEqual([
        "chat-1",
        "chat-2",
      ]);
    });

    it("lets a second process (a new home on the same tables) see the same tenant", async () => {
      const tenantId = tenant();
      const storage = postgresStorage({ db, ensureSchema: true });
      const web = await createTenantHome({
        tenantId,
        storage,
        definition: agent,
        sandbox: false,
      });
      await web.volume.writeFile("memories/MEMORY.md", "Brand color is violet\n");
      resetTenantHomeCache(); // what a separate worker process would have

      const worker = createAgentKit({
        storage: postgresStorage({ db }),
        definition: agent,
        sandbox: false,
        curatorRunner: async () => ({
          text: "",
          toolCalls: [
            {
              name: "memory",
              args: {
                action: "add",
                target: "user",
                content: "Prefers short posts",
              },
            },
          ],
        }),
      });
      const job: CuratorJob = {
        v: 1,
        tenantId,
        sessionId: "chat-1",
        conversation: [{ role: "user", content: "Keep them short." }],
        createdAt: 1,
      };
      const outcome = await worker.review(job);
      expect(outcome?.applied).toHaveLength(1);

      const { memory } = await (await worker.home(tenantId)).stores();
      expect(memory.getEntries("memory")).toEqual(["Brand color is violet"]);
      expect(memory.getEntries("user")).toEqual(["Prefers short posts"]);
    });
  });

  describe("maintenance helpers", () => {
    it("deletes one tenant and leaves others", async () => {
      const storage = postgresStorage({ db, ensureSchema: true });
      const [a, b] = [tenant(), tenant()];
      for (const id of [a, b]) {
        const { volume, transcripts } = await storage.open(id);
        await volume.writeFile("memories/USER.md", id);
        await transcripts.createSession({
          id: "s",
          tenantId: id,
          source: "chat",
          createdAt: 1,
        });
        await transcripts.appendMessage({
          id: "m",
          sessionId: "s",
          role: "user",
          content: "x",
          createdAt: 2,
        });
      }
      expect(await deletePostgresTenant(db, a)).toEqual({
        files: 1,
        sessions: 1,
      });
      expect(await (await storage.open(a)).volume.readFile("memories/USER.md")).toBeNull();
      expect(await (await storage.open(b)).volume.readFile("memories/USER.md")).toBe(b);
      expect(await (await storage.open(b)).transcripts.scroll("s")).toHaveLength(1);
    });

    it("prunes sessions with no recent activity", async () => {
      const storage = postgresStorage({ db, ensureSchema: true });
      const id = tenant();
      const { transcripts } = await storage.open(id);
      const day = 86_400;
      const now = Date.now() / 1000;
      await transcripts.createSession({
        id: "stale",
        tenantId: id,
        source: "chat",
        createdAt: now - 100 * day,
      });
      await transcripts.appendMessage({
        id: "m",
        sessionId: "stale",
        role: "user",
        content: "old",
        createdAt: now - 99 * day,
      });
      await transcripts.createSession({
        id: "revived",
        tenantId: id,
        source: "chat",
        createdAt: now - 100 * day,
      });
      await transcripts.appendMessage({
        id: "m",
        sessionId: "revived",
        role: "user",
        content: "new",
        createdAt: now - day,
      });
      await transcripts.createSession({
        id: "fresh",
        tenantId: id,
        source: "chat",
        createdAt: now,
      });

      const removed = await prunePostgresTranscripts(db, {
        inactiveBefore: new Date((now - 90 * day) * 1000),
        tenantId: id,
      });
      expect(removed).toBe(1);
      expect((await transcripts.listSessions(id)).map((s) => s.id).sort()).toEqual([
        "fresh",
        "revived",
      ]);
    });
  });
});
