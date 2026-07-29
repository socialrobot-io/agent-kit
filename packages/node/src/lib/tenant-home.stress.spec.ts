/**
 * Offline concurrency stress: many tenants × many chats, no live LLMs.
 *
 * Answers: can multiple users and multiple chats for one user run in parallel
 * through createTenantHome / openSession / run without locking up?
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { LanguageModel } from "ai";
import { resetAgentFsOpenCache } from "@socialrobot-io/agent-kit-sandbox";
import { createTenantHome, resetTenantHomeCache, type TenantHome } from "./tenant-home.js";

afterEach(() => {
  resetTenantHomeCache();
  resetAgentFsOpenCache();
});

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** Mock model with a small delay so turns actually overlap. */
function mockModel(text: string, delayMs = 5): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock-stress",
    supportedUrls: {},
    async doGenerate() {
      await new Promise((r) => setTimeout(r, delayMs));
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

type TurnResult = {
  tenantId: string;
  sessionId: string;
  text: string;
  ms: number;
  error?: string;
};

async function bootHome(dataDir: string, tenantId: string): Promise<TenantHome> {
  const home = await createTenantHome({
    tenantId,
    dataDir,
    // Default model unused when each session overrides; still required for boot.
    model: mockModel("unused"),
    sandbox: false,
  });
  await home.volume.writeFile("agent/SOUL.md", `You serve ${tenantId}.`);
  return home;
}

async function runChat(
  home: TenantHome,
  sessionId: string,
  reply: string,
  delayMs = 8,
): Promise<TurnResult> {
  const start = performance.now();
  try {
    // Per-session model: home is cached once; chat replies must not share one mock.
    const session = await home.openSession(sessionId, {
      model: mockModel(reply, delayMs),
    });
    const turn = await session.run([{ role: "user", content: `ping ${sessionId}` }]);

    // Host-style transcript persist (example-app does this outside the kit).
    if (home.transcripts) {
      await home.transcripts.appendMessage({
        id: `${sessionId}-u`,
        sessionId,
        role: "user",
        content: `ping ${sessionId}`,
        createdAt: Date.now() / 1000,
      });
      await home.transcripts.appendMessage({
        id: `${sessionId}-a`,
        sessionId,
        role: "assistant",
        content: turn.text ?? "",
        createdAt: Date.now() / 1000,
      });
    }

    return {
      tenantId: home.tenantId,
      sessionId,
      text: turn.text ?? "",
      ms: performance.now() - start,
    };
  } catch (err) {
    return {
      tenantId: home.tenantId,
      sessionId,
      text: "",
      ms: performance.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

describe("createTenantHome concurrency stress (no LLM)", () => {
  it("runs many chats for one tenant in parallel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-stress-same-"));
    const CHATS = 24;
    try {
      const home = await bootHome(dir, "user-1");

      const wallStart = performance.now();
      const results = await Promise.all(
        Array.from({ length: CHATS }, (_, i) => runChat(home, `chat-${i}`, `ok-${i}`)),
      );
      const wallMs = performance.now() - wallStart;

      const failures = results.filter((r) => r.error);
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);

      for (let i = 0; i < CHATS; i++) {
        const hit = results.find((r) => r.sessionId === `chat-${i}`);
        expect(hit?.text).toBe(`ok-${i}`);
      }

      const sessions = await home.transcripts!.listSessions("user-1");
      expect(sessions.map((s) => s.id).sort()).toEqual(
        Array.from({ length: CHATS }, (_, i) => `chat-${i}`).sort(),
      );

      const sumMs = results.reduce((a, r) => a + r.ms, 0);
      expect(wallMs).toBeLessThan(sumMs * 0.6);

      // eslint-disable-next-line no-console
      console.log(
        `[same-tenant] ${CHATS} chats wall=${wallMs.toFixed(0)}ms sum=${sumMs.toFixed(0)}ms ` +
          `speedup=${(sumMs / wallMs).toFixed(1)}x`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("runs many tenants × many chats in parallel with isolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-stress-multi-"));
    const TENANTS = 8;
    const CHATS_PER = 6;
    try {
      // Boot all tenant homes concurrently (separate SQLite volumes).
      const homes = await Promise.all(
        Array.from({ length: TENANTS }, (_, t) => bootHome(dir, `tenant-${t}`)),
      );

      const jobs: Promise<TurnResult>[] = [];
      for (let t = 0; t < TENANTS; t++) {
        for (let c = 0; c < CHATS_PER; c++) {
          jobs.push(runChat(homes[t], `t${t}-chat-${c}`, `t${t}-c${c}`, 5));
        }
      }

      const wallStart = performance.now();
      const results = await Promise.all(jobs);
      const wallMs = performance.now() - wallStart;

      const failures = results.filter((r) => r.error);
      expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
      expect(results).toHaveLength(TENANTS * CHATS_PER);

      for (let t = 0; t < TENANTS; t++) {
        for (let c = 0; c < CHATS_PER; c++) {
          const hit = results.find(
            (r) => r.tenantId === `tenant-${t}` && r.sessionId === `t${t}-chat-${c}`,
          );
          expect(hit?.text).toBe(`t${t}-c${c}`);
        }
      }

      for (let t = 0; t < TENANTS; t++) {
        const home = homes[t];
        const mine = await home.transcripts!.listSessions(`tenant-${t}`);
        expect(mine).toHaveLength(CHATS_PER);
        expect(mine.every((s) => s.tenantId === `tenant-${t}`)).toBe(true);

        for (const s of mine) {
          const msgs = await home.transcripts!.scroll(s.id, 0, 100);
          expect(msgs.some((m) => m.content.includes(`ping ${s.id}`))).toBe(true);
          for (let other = 0; other < TENANTS; other++) {
            if (other === t) continue;
            expect(msgs.some((m) => m.content.includes(`tenant-${other}`))).toBe(false);
          }
        }
      }

      const sumMs = results.reduce((a, r) => a + r.ms, 0);
      // eslint-disable-next-line no-console
      console.log(
        `[multi-tenant] ${TENANTS}×${CHATS_PER}=${results.length} turns ` +
          `wall=${wallMs.toFixed(0)}ms sum=${sumMs.toFixed(0)}ms ` +
          `speedup=${(sumMs / wallMs).toFixed(1)}x`,
      );
      expect(wallMs).toBeLessThan(sumMs * 0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("retains all concurrent same-tenant memory writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-stress-mem-"));
    const WRITERS = 32;
    try {
      const home = await bootHome(dir, "mem-user");

      // Open first, then barrier-fire adds so reload→mutate→write overlaps hard.
      const sessions = await Promise.all(
        Array.from({ length: WRITERS }, (_, i) => home.openSession(`mem-chat-${i}`)),
      );
      const writes = await Promise.all(
        sessions.map((session, i) => session.memory.add("user", `fact-${i}`)),
      );

      expect(writes.every((w) => w.success)).toBe(true);

      const check = await home.openSession("mem-check");
      await check.runtime.refreshMemory();
      const entries = check.memory.getEntries("user");
      const expected = Array.from({ length: WRITERS }, (_, i) => `fact-${i}`).sort();
      expect([...entries].sort()).toEqual(expected);

      // eslint-disable-next-line no-console
      console.log(`[memory-rmw] wrote=${WRITERS} retained=${entries.length} missing=0`);
      expect(await home.volume.readFile("memories/USER.md")).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
