import { describe, it, expect, beforeEach } from "vitest";
import {
  assertTenantSession,
  InMemoryTranscriptStore,
  searchWords,
  sessionSearch,
  type Session,
  type SessionMessage,
} from "./transcript.js";

function makeSession(id: string, tenantId: string): Session {
  return { id, tenantId, source: "generic", createdAt: Date.now() / 1000 };
}
let n = 0;
function makeMsg(sessionId: string, role: SessionMessage["role"], content: string): SessionMessage {
  return { id: `m${++n}`, sessionId, role, content, createdAt: Date.now() / 1000 + n };
}

describe("InMemoryTranscriptStore + sessionSearch", () => {
  let store: InMemoryTranscriptStore;

  beforeEach(() => {
    store = new InMemoryTranscriptStore();
  });

  it("finds messages by query within a tenant", async () => {
    await store.createSession(makeSession("s1", "tenantA"));
    await store.appendMessage(makeMsg("s1", "user", "How do I deploy to Kubernetes?"));
    const res = await sessionSearch(store, "tenantA", { query: "kubernetes" });
    expect(res.success).toBe(true);
    expect(res.mode).toBe("discovery");
    expect(res.hits).toHaveLength(1);
    expect(res.hits![0].sessionId).toBe("s1");
  });

  it("never returns another tenant's messages", async () => {
    await store.createSession(makeSession("s1", "tenantA"));
    await store.createSession(makeSession("s2", "tenantB"));
    await store.appendMessage(makeMsg("s1", "user", "tenant A secret about kubernetes"));
    await store.appendMessage(makeMsg("s2", "user", "tenant B kubernetes note"));
    const resA = await sessionSearch(store, "tenantA", { query: "kubernetes" });
    expect(resA.hits).toHaveLength(1);
    expect(resA.hits![0].sessionId).toBe("s1");
  });

  it("scrolls within a session", async () => {
    await store.createSession(makeSession("s1", "tenantA"));
    for (let i = 0; i < 5; i++) await store.appendMessage(makeMsg("s1", "user", `msg ${i}`));
    const res = await sessionSearch(store, "tenantA", { session_id: "s1", offset: 2, limit: 2 });
    expect(res.mode).toBe("scroll");
    expect(res.messages).toHaveLength(2);
    expect(res.messages![0].content).toBe("msg 2");
  });

  it("browses sessions when called with no args", async () => {
    await store.createSession(makeSession("s1", "tenantA"));
    await store.createSession(makeSession("s2", "tenantA"));
    const res = await sessionSearch(store, "tenantA", {});
    expect(res.success).toBe(true);
    expect(res.mode).toBe("browse");
    expect(res.sessions!.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("assertTenantSession accepts owned sessions and rejects others", async () => {
    await store.createSession(makeSession("s1", "tenantA"));
    await expect(assertTenantSession(store, "tenantA", "s1")).resolves.toMatchObject({
      id: "s1",
      tenantId: "tenantA",
    });
    await expect(assertTenantSession(store, "tenantB", "s1")).rejects.toThrow(/not found/);
  });
});

describe("sessionSearch when no message has every word", () => {
  let store: InMemoryTranscriptStore;

  beforeEach(async () => {
    store = new InMemoryTranscriptStore();
    await store.createSession(makeSession("launch", "t1"));
    await store.appendMessage(makeMsg("launch", "user", "Write a LinkedIn post launching approval flows."));
    await store.appendMessage(makeMsg("launch", "assistant", "Draft: Approval flows are live."));
    await store.createSession(makeSession("chatter", "t1"));
    await store.appendMessage(makeMsg("chatter", "user", "What time is it? I'd like a coffee."));
    await store.appendMessage(makeMsg("chatter", "user", "Last time we talked about time zones."));
  });

  it("returns messages with some of the words, rare words first", async () => {
    const res = await sessionSearch(store, "t1", { query: "NetSuite launch posts like last time" });
    expect(res.success).toBe(true);
    expect(res.match).toBe("some");
    expect(res.message).toMatch(/some of them/);
    expect(res.hits![0].sessionId).toBe("launch");
    expect(res.hits![0].snippet).toContain("launching");
  });

  it("keeps the current chat out of some-word hits", async () => {
    const res = await sessionSearch(
      store,
      "t1",
      { query: "NetSuite launch posts" },
      { currentSessionId: "launch" },
    );
    expect(res.hits!.every((hit) => hit.sessionId !== "launch")).toBe(true);
  });

  it("reports a full match when a message has the query", async () => {
    const res = await sessionSearch(store, "t1", { query: "approval flows" });
    expect(res.match).toBe("all");
    expect(res.message).toBeUndefined();
    expect(res.hits).toHaveLength(2);
  });

  it("returns no hits when no word matches", async () => {
    const res = await sessionSearch(store, "t1", { query: "kubernetes" });
    expect(res.success).toBe(true);
    expect(res.hits).toEqual([]);
  });

  it("splits a query into searchable words", () => {
    expect(searchWords("NetSuite sync: launch POSTS, ok?")).toEqual(["netsuite", "sync", "launch", "post"]);
  });
});
