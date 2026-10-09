import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  assertTenantSession,
  createSessionSearchTool,
  sessionSearch,
  type SessionSearchResult,
} from "@socialrobot-io/agent-kit-sessions";
import type { SqlClient } from "./sql.js";
import { PostgresTranscriptStore } from "./postgres-transcripts.js";
import { backends, runId, type OpenBackend } from "../../tests/pg-backends.js";

describe.each(backends)("transcripts on $name", (backend) => {
  let open: OpenBackend;
  let db: SqlClient;
  let n = 0;

  beforeAll(async () => {
    open = await backend.open();
    db = open.db;
  });

  afterAll(async () => {
    await open?.close();
  });

  /** Fresh tenant per test. */
  function store(): PostgresTranscriptStore {
    return new PostgresTranscriptStore({ db, tenantId: `tx-${runId}-${++n}` });
  }

  async function seed(
    s: PostgresTranscriptStore,
    sessionId: string,
    at: number,
    msgs: [string, string][],
  ) {
    await s.createSession({
      id: sessionId,
      tenantId: s.tenantId,
      source: "chat",
      createdAt: at,
    });
    let i = 0;
    for (const [role, content] of msgs) {
      i++;
      await s.appendMessage({
        id: `${sessionId}-m${i}`,
        sessionId,
        role: role as "user" | "assistant",
        content,
        createdAt: at + i,
      });
    }
  }

  describe("PostgresTranscriptStore", () => {
    it("creates sessions idempotently and lists them newest first", async () => {
      const s = store();
      await s.createSession({
        id: "a",
        tenantId: s.tenantId,
        source: "chat",
        createdAt: 100,
      });
      await s.createSession({
        id: "b",
        tenantId: s.tenantId,
        source: "mcp",
        createdAt: 200,
      });
      await s.createSession({
        id: "a",
        tenantId: s.tenantId,
        source: "other",
        createdAt: 999,
      });
      const listed = await s.listSessions(s.tenantId);
      expect(listed.map((x) => [x.id, x.source, x.createdAt])).toEqual([
        ["b", "mcp", 200],
        ["a", "chat", 100],
      ]);
      expect(await s.listSessions(s.tenantId, 1)).toHaveLength(1);
      expect(await s.getSession(s.tenantId, "a")).toMatchObject({
        id: "a",
        tenantId: s.tenantId,
      });
      expect(await s.getSession(s.tenantId, "zzz")).toBeNull();
    });

    it("appends idempotently, keeps append order, and round-trips tool calls", async () => {
      const s = store();
      await seed(s, "chat", 100, [
        ["user", "first"],
        ["assistant", "second"],
      ]);
      await s.appendMessage({
        id: "chat-m1",
        sessionId: "chat",
        role: "user",
        content: "dup",
        createdAt: 1,
      });
      await s.appendMessage({
        id: "tool",
        sessionId: "chat",
        role: "tool",
        content: "{}",
        toolCalls: [{ name: "memory", args: { action: "add" } }],
        createdAt: 50,
      });
      const all = await s.scroll("chat", 0, 10);
      expect(all.map((m) => m.content)).toEqual(["first", "second", "{}"]);
      expect(all[2]?.toolCalls).toEqual([{ name: "memory", args: { action: "add" } }]);
      expect((await s.scroll("chat", 1, 1)).map((m) => m.content)).toEqual(["second"]);
    });

    it("throws on an unknown session", async () => {
      const s = store();
      await expect(
        s.appendMessage({
          id: "x",
          sessionId: "missing",
          role: "user",
          content: "hi",
          createdAt: 1,
        }),
      ).rejects.toThrow(/Unknown session/);
    });

    it("finds substrings case-insensitively and words in any order", async () => {
      const s = store();
      await seed(s, "old", 100, [["user", "Plan for the LAUNCH next week"]]);
      await seed(s, "new", 200, [["assistant", "The launch plan is ready"]]);
      const sub = await s.search(s.tenantId, "launch");
      expect(sub.map((h) => h.sessionId)).toEqual(["new", "old"]);
      expect(sub[0]?.snippet).toContain("launch plan");
      const words = await s.search(s.tenantId, "launch plan");
      expect(words.map((h) => h.sessionId).sort()).toEqual(["new", "old"]);
      expect(await s.search(s.tenantId, "   ")).toEqual([]);
      expect(await s.search(s.tenantId, '"" !!!')).toEqual([]);
    });

    it("never reads or writes across tenants", async () => {
      const a = store();
      const b = store();
      await seed(a, "shared-id", 100, [["user", "secret recipe"]]);
      await seed(b, "shared-id", 100, [["user", "other text"]]);
      expect(await b.search(b.tenantId, "secret")).toEqual([]);
      expect(await b.search(a.tenantId, "secret")).toEqual([]);
      expect(await b.listSessions(a.tenantId)).toEqual([]);
      expect(await b.getSession(a.tenantId, "shared-id")).toBeNull();
      expect((await b.scroll("shared-id")).map((m) => m.content)).toEqual(["other text"]);
      await expect(
        b.createSession({
          id: "x",
          tenantId: a.tenantId,
          source: "chat",
          createdAt: 1,
        }),
      ).rejects.toThrow(/not/);
    });

    it("deletes a session with its messages", async () => {
      const s = store();
      await seed(s, "gone", 100, [["user", "bye"]]);
      expect(await s.deleteSession("gone")).toBe(true);
      expect(await s.deleteSession("gone")).toBe(false);
      expect(await s.scroll("gone")).toEqual([]);
      expect(await s.search(s.tenantId, "bye")).toEqual([]);
    });
  });

  describe("session_search on Postgres", () => {
    it("excludes the current chat from discovery and browse", async () => {
      const s = store();
      await seed(s, "past", 100, [["user", "crea un perfil del Guasón (villanos de Batman)"]]);
      await seed(s, "current", 300, [["user", "eliminamos a los villanos?"]]);

      const found = await sessionSearch(
        s,
        s.tenantId,
        { query: "villanos" },
        { currentSessionId: "current" },
      );
      expect(found.hits?.map((h) => h.sessionId)).toEqual(["past"]);

      const browse = await sessionSearch(
        s,
        s.tenantId,
        { limit: 1 },
        { currentSessionId: "current" },
      );
      expect(browse.sessions?.map((x) => x.id)).toEqual(["past"]);

      const tool = createSessionSearchTool(s, s.tenantId, {
        currentSessionId: "current",
      });
      const scroll = (await tool.execute({
        session_id: "past",
      })) as SessionSearchResult;
      expect(scroll.messages?.[0]?.content).toContain("Guasón");
      await expect(assertTenantSession(s, s.tenantId, "past")).resolves.toMatchObject({
        id: "past",
      });
      await expect(assertTenantSession(s, "someone-else", "past")).rejects.toThrow(/not found/);
    });
  });
});
