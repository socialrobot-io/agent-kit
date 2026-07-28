/**
 * Regression: cross-session recall must not circularly return the active chat.
 *
 * Failure mode (example chat): user asks "qué hicimos?" in a new thread; the
 * agent scrolled the current session_id and summarized itself instead of past
 * villain / 1+1 sessions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryTranscriptStore,
  sessionSearch,
  type Session,
  type SessionMessage,
} from "./transcript.js";
import { createSessionSearchTool } from "./session-search-tool.js";

function makeSession(id: string, createdAt: number): Session {
  return { id, tenantId: "demo-user", source: "composer", createdAt };
}

let n = 0;
function makeMsg(
  sessionId: string,
  role: SessionMessage["role"],
  content: string,
  createdAt: number,
): SessionMessage {
  return { id: `m${++n}`, sessionId, role, content, createdAt };
}

describe("session_search regression (current-session exclusion)", () => {
  let store: InMemoryTranscriptStore;
  const currentId = "9fd0e8f8-current";
  const pastVillainsId = "past-villains";
  const pastMathId = "past-math";

  beforeEach(async () => {
    store = new InMemoryTranscriptStore();
    await store.createSession(makeSession(pastMathId, 100));
    await store.createSession(makeSession(pastVillainsId, 200));
    await store.createSession(makeSession(currentId, 300));

    await store.appendMessage(
      makeMsg(pastMathId, "user", "1+1 = 3 from now on", 101),
    );
    await store.appendMessage(
      makeMsg(pastMathId, "assistant", "Got it. From now on 1 + 1 = 3. Stored for future sessions.", 102),
    );
    await store.appendMessage(
      makeMsg(pastVillainsId, "user", "crea un perfil del Guasón (villanos de Batman)", 201),
    );
    await store.appendMessage(
      makeMsg(pastVillainsId, "assistant", "Creé /workspace/batman-villains/Joker.md", 202),
    );
    await store.appendMessage(
      makeMsg(currentId, "user", "eliminamos a los villanos?", 301),
    );
    await store.appendMessage(
      makeMsg(currentId, "assistant", "Tengo un skill batman-villain-profile…", 302),
    );
    await store.appendMessage(
      makeMsg(currentId, "user", "no, me refiero a antes. que hicimos?", 303),
    );
  });

  it("discovery for villains returns only the past session, not the current ask", async () => {
    const res = await sessionSearch(
      store,
      "demo-user",
      { query: "villanos" },
      { currentSessionId: currentId },
    );
    expect(res.success).toBe(true);
    expect(res.mode).toBe("discovery");
    expect(res.hits!.every((h) => h.sessionId === pastVillainsId)).toBe(true);
    expect(res.hits!.some((h) => h.sessionId === currentId)).toBe(false);
  });

  it("browse lists past sessions and never the active chat", async () => {
    const res = await sessionSearch(store, "demo-user", {}, { currentSessionId: currentId });
    expect(res.mode).toBe("browse");
    const ids = res.sessions!.map((s) => s.id);
    expect(ids).toContain(pastVillainsId);
    expect(ids).toContain(pastMathId);
    expect(ids).not.toContain(currentId);
  });

  it("rejects scrolling the current session (the circular-recall bug)", async () => {
    const res = await sessionSearch(
      store,
      "demo-user",
      { session_id: currentId },
      { currentSessionId: currentId },
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/current chat/i);
  });

  it("still scrolls a past session after discovery", async () => {
    const res = await sessionSearch(
      store,
      "demo-user",
      { session_id: pastVillainsId },
      { currentSessionId: currentId },
    );
    expect(res.success).toBe(true);
    expect(res.mode).toBe("scroll");
    expect(res.messages!.some((m) => m.content.includes("Joker.md"))).toBe(true);
  });

  it("createSessionSearchTool binds currentSessionId into execute", async () => {
    const tool = createSessionSearchTool(store, "demo-user", { currentSessionId: currentId });
    expect(tool.name).toBe("session_search");
    expect(tool.description).toMatch(/BROWSE/i);
    expect(tool.description).toMatch(/current/i);

    const browse = (await tool.execute({})) as { mode?: string; sessions?: { id: string }[] };
    expect(browse.mode).toBe("browse");
    expect(browse.sessions!.map((s) => s.id)).not.toContain(currentId);

    const scrollSelf = (await tool.execute({ session_id: currentId })) as {
      success: boolean;
    };
    expect(scrollSelf.success).toBe(false);

    const withOverride = (await tool.execute({
      session_id: currentId,
      include_current: true,
    })) as { success: boolean; messages?: unknown[] };
    expect(withOverride.success).toBe(true);
    expect(withOverride.messages!.length).toBeGreaterThan(0);
  });

  it("include_current=true opts back into discovery hits on the active chat", async () => {
    const res = await sessionSearch(
      store,
      "demo-user",
      { query: "villanos", include_current: true },
      { currentSessionId: currentId },
    );
    expect(res.hits!.some((h) => h.sessionId === currentId)).toBe(true);
    expect(res.hits!.some((h) => h.sessionId === pastVillainsId)).toBe(true);
  });
});
