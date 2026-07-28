/**
 * `agent-kit demo` — end-to-end proof of the self-improvement primitives.
 *
 * Demonstrates, on one generic agent and two tenants:
 *  1. Tenant A runs a session; the user corrects the agent's verbosity.
 *  2. The background curator reviews the transcript and distills a durable
 *     memory + a reusable skill (staged via write_approval).
 *  3. A reviewer approves the staged writes.
 *  4. Tenant A starts a SECOND session — the frozen snapshot now contains the
 *     distilled memory, and skills_list shows the new skill.
 *  5. Tenant B runs a session on its OWN isolated agent home and sees nothing
 *     of Tenant A's memory or skills (multi-tenant isolation).
 *
 * Uses deterministic scripted model runners (no network) so it runs anywhere.
 * Swap the scripted CuratorModelRunner / reply runner for a real LLM (Vercel
 * AI SDK `streamText`) in production.
 */

import { AgentSessionRuntime, defineAgent, InMemoryFs } from "@agent-kit/core";
import { runBackgroundReview, applySkill, COMBINED_REVIEW_PROMPT, type CuratorModelRunner } from "@agent-kit/curator";
import { InMemoryTranscriptStore } from "@agent-kit/sessions";

interface DemoTenant {
  tenantId: string;
  fs: InMemoryFs;
  runtime: AgentSessionRuntime;
}

async function makeTenant(tenantId: string, writeApproval: boolean): Promise<DemoTenant> {
  const fs = new InMemoryFs();
  // Eve-like agent/ authoring surface.
  await fs.writeFile("agent/SOUL.md", "You are a concise research assistant.");
  await fs.writeFile("agent/AGENTS.md", "Prefer short, factual answers.");
  const runtime = new AgentSessionRuntime({
    tenantId,
    fs,
    definition: defineAgent({ model: "demo/scripted", config: { writeApproval: { memory: writeApproval, skills: writeApproval } } }),
    origin: "foreground",
  });
  await runtime.init();
  return { tenantId, fs, runtime };
}

/** Scripted curator "model": acts like a real review pass would. */
function scriptedCurator(): CuratorModelRunner {
  return async ({ systemPrompt }) => {
    if (!systemPrompt.includes("**Skills**")) throw new Error("expected combined review prompt");
    return {
      text: "User dislikes verbosity; saving a preference and a conciseness skill.",
      toolCalls: [
        { name: "memory", args: { action: "add", target: "user", content: "User wants terse, no-fluff answers" } },
        { name: "skill_manage", args: { action: "create", name: "concise-answers", content: "---\ndescription: Answer tersely\n---\nLead with the answer; skip preamble." } },
      ],
    };
  };
}

/** Approve every staged write by replaying it through the runtime. */
async function approveAllPending(t: DemoTenant): Promise<void> {
  for (const rec of await t.runtime.pending.list("memory")) {
    const { target, action, content, old_text } = rec.payload as Record<string, string>;
    if (action === "add") await t.runtime.memory.add(target as "user" | "memory", content);
    else if (action === "replace") await t.runtime.memory.replace(target as "user" | "memory", old_text, content);
    else if (action === "remove") await t.runtime.memory.remove(target as "user" | "memory", old_text);
    await t.runtime.pending.discard("memory", rec.id);
  }
  for (const rec of await t.runtime.pending.list("skills")) {
    await applySkill(rec.payload, { skills: t.runtime.skills });
    await t.runtime.pending.discard("skills", rec.id);
  }
}

export async function runDemo(log: (s: string) => void = console.log): Promise<boolean> {
  const transcripts = new InMemoryTranscriptStore();
  let ok = true;
  const check = (label: string, cond: boolean) => {
    log(`  ${cond ? "✓" : "✗"} ${label}`);
    ok = ok && cond;
  };

  log("=== Session 1 (tenant A) ===");
  const A = await makeTenant("tenantA", true);
  const sessionId = "s1";
  await transcripts.createSession({ id: sessionId, tenantId: "tenantA", source: "generic", createdAt: Date.now() / 1000 });
  const convo = [
    { role: "user" as const, content: "Explain Postgres indexes. And stop being so verbose." },
    { role: "assistant" as const, content: "B-tree index: sorted structure for fast equality/range lookups." },
  ];
  for (const [i, m] of convo.entries()) {
    await transcripts.appendMessage({ id: `m${i}`, sessionId, role: m.role, content: m.content, createdAt: Date.now() / 1000 + i });
  }
  check("session 1 snapshot has no memory yet", !A.runtime.systemPrompt().includes("terse"));

  log("=== Curator review (background) ===");
  const outcome = await runBackgroundReview(convo, {
    memory: A.runtime.memory,
    skills: A.runtime.skills,
    pending: A.runtime.pending,
    writeApprovalEnabled: () => true,
    mode: "combined",
    model: scriptedCurator(),
  });
  check("curator staged a memory write", outcome.staged.some((s) => s.subsystem === "memory"));
  check("curator staged a skill write", outcome.staged.some((s) => s.subsystem === "skills"));
  check("nothing applied before approval", outcome.applied.length === 0);
  check("memory not yet live", A.runtime.memory.getEntries("user").length === 0);

  log("=== Approve staged writes ===");
  await approveAllPending(A);
  check("pending cleared", (await A.runtime.pending.count("memory")) === 0 && (await A.runtime.pending.count("skills")) === 0);
  check("memory now live on disk", A.runtime.memory.getEntries("user").includes("User wants terse, no-fluff answers"));

  log("=== Session 2 (tenant A) — recall ===");
  const A2 = await makeTenant("tenantA", true);
  A2.fs = A.fs; // same agent home (same tenant volume)
  const runtime2 = new AgentSessionRuntime({ tenantId: "tenantA", fs: A.fs, origin: "foreground" });
  await runtime2.init();
  check("session 2 snapshot recalls memory", runtime2.systemPrompt().includes("User wants terse, no-fluff answers"));
  const skillNames = (await runtime2.skills.list()).map((s) => s.name);
  check("session 2 sees the distilled skill", skillNames.includes("concise-answers"));

  log("=== Cross-session FTS recall ===");
  const hits = await transcripts.search("tenantA", "indexes");
  check("session_search finds session 1", hits.some((h) => h.sessionId === sessionId));

  log("=== Tenant B — isolation ===");
  const B = await makeTenant("tenantB", true);
  check("tenant B has its own empty memory", B.runtime.memory.getEntries("user").length === 0);
  check("tenant B snapshot has no tenant A memory", !B.runtime.systemPrompt().includes("terse"));
  check("tenant B has no tenant A skills", (await B.runtime.skills.list()).length === 0);
  check("tenant B FTS is empty", (await transcripts.search("tenantB", "indexes")).length === 0);

  log(ok ? "\nDEMO PASSED" : "\nDEMO FAILED");
  return ok;
}

// Run when invoked directly: `bun packages/cli/src/lib/demo.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().then((ok) => process.exit(ok ? 0 : 1));
}

export { COMBINED_REVIEW_PROMPT };
