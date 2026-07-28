import { describe, it, expect, beforeEach } from "vitest";
import { FileTranscriptStore, type TranscriptFs } from "./file-store.js";
import { sessionSearch } from "./transcript.js";

class MemFs implements TranscriptFs {
  private files = new Map<string, string>();
  async readFile(path: string): Promise<string | null> {
    return this.files.has(path) ? this.files.get(path)! : null;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

describe("FileTranscriptStore", () => {
  let fs: MemFs;
  let store: FileTranscriptStore;

  beforeEach(() => {
    fs = new MemFs();
    store = new FileTranscriptStore({ fs });
  });

  it("persists sessions and messages across store instances", async () => {
    await store.createSession({
      id: "s1",
      tenantId: "t1",
      source: "generic",
      createdAt: 100,
    });
    await store.appendMessage({
      id: "m1",
      sessionId: "s1",
      role: "user",
      content: "Remember Batman villains",
      createdAt: 101,
    });

    const again = new FileTranscriptStore({ fs });
    const listed = await again.listSessions("t1");
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("s1");
    const msgs = await again.scroll("s1");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("Batman");
  });

  it("is idempotent on appendMessage by id", async () => {
    await store.createSession({ id: "s1", tenantId: "t1", source: "generic", createdAt: 1 });
    const msg = { id: "m1", sessionId: "s1", role: "user" as const, content: "hi", createdAt: 2 };
    await store.appendMessage(msg);
    await store.appendMessage(msg);
    expect(await store.scroll("s1")).toHaveLength(1);
  });

  it("searches within a tenant only", async () => {
    await store.createSession({ id: "a", tenantId: "t1", source: "generic", createdAt: 1 });
    await store.createSession({ id: "b", tenantId: "t2", source: "generic", createdAt: 1 });
    await store.appendMessage({ id: "1", sessionId: "a", role: "user", content: "secret alpha", createdAt: 2 });
    await store.appendMessage({ id: "2", sessionId: "b", role: "user", content: "secret beta", createdAt: 2 });
    const res = await sessionSearch(store, "t1", { query: "secret" });
    expect(res.hits).toHaveLength(1);
    expect(res.hits![0].sessionId).toBe("a");
  });

  it("rejects scroll for another tenant's session id", async () => {
    await store.createSession({ id: "a", tenantId: "t1", source: "generic", createdAt: 1 });
    await store.appendMessage({ id: "1", sessionId: "a", role: "user", content: "hi", createdAt: 2 });
    const res = await sessionSearch(store, "t2", { session_id: "a" });
    expect(res.success).toBe(false);
  });
});
