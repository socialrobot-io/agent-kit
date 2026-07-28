/**
 * Scripted live demo: session → curator → approve → recall on a second session.
 * Requires AI_GATEWAY_API_KEY. Persists the agent home in an AgentFS volume.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentFS } from "agentfs-sdk";
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";
import { runBackgroundReview } from "@agent-kit/curator";
import { InMemoryTranscriptStore } from "@agent-kit/sessions";
import { aiCuratorRunner, runAgentTurn } from "@agent-kit/ai";
import { MODEL, requireGatewayKey } from "./env.js";
import { adaptAgentFs } from "./fs-adapter.js";
import { approveAllPending } from "./approve.js";
import { examplePackageRoot, seedAgentHome } from "./seed.js";

async function main(): Promise<void> {
  requireGatewayKey();
  console.log(`Model: ${MODEL}\n`);

  const volumeDir = join(examplePackageRoot(), ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });
  const afs = await AgentFS.open({ path: volumePath });
  const fs = adaptAgentFs(afs.fs);

  const seeded = await seedAgentHome(fs);
  if (seeded.length) console.log(`Seeded: ${seeded.join(", ")}\n`);
  else console.log("Agent home already present (keeping learned state).\n");

  const definition = defineAgent({
    model: MODEL,
    config: { writeApproval: { memory: true, skills: true } },
  });

  // ── Session 1 ────────────────────────────────────────────────────────────
  console.log("=== Session 1 ===");
  const runtime = new AgentSessionRuntime({
    tenantId: "demo-user",
    fs,
    definition,
    origin: "foreground",
  });
  await runtime.init();

  const userMsg =
    "Hi! I'm Nico. I prefer short bullet-point answers, and my main project is a Bun + Nx monorepo called post-scheduler. Remember that.";

  const turn1 = await runAgentTurn([{ role: "user", content: userMsg }], {
    runtime,
    model: MODEL,
  });

  console.log("\nAssistant:");
  console.log(turn1.text || "(no text)");
  if (turn1.toolCalls.length) {
    console.log("\nTool calls:");
    for (const tc of turn1.toolCalls) {
      console.log(`  - ${tc.name}`, JSON.stringify(tc.args));
    }
  } else {
    console.log("\n(no tool calls this turn)");
  }

  const transcripts = new InMemoryTranscriptStore();
  const sessionId = "session-1";
  await transcripts.createSession({
    id: sessionId,
    tenantId: "demo-user",
    source: "example-app",
    createdAt: Date.now() / 1000,
  });
  await transcripts.appendMessage({
    id: "m0",
    sessionId,
    role: "user",
    content: userMsg,
    createdAt: Date.now() / 1000,
  });
  await transcripts.appendMessage({
    id: "m1",
    sessionId,
    role: "assistant",
    content: turn1.text,
    toolCalls: turn1.toolCalls,
    createdAt: Date.now() / 1000 + 1,
  });

  // ── Curator ──────────────────────────────────────────────────────────────
  console.log("\n=== Curator (combined review) ===");
  const conversation = [
    { role: "user" as const, content: userMsg },
    { role: "assistant" as const, content: turn1.text },
  ];
  const outcome = await runBackgroundReview(conversation, {
    memory: runtime.memory,
    skills: runtime.skills,
    pending: runtime.pending,
    writeApprovalEnabled: () => true,
    mode: "combined",
    model: aiCuratorRunner(MODEL),
  });

  console.log("\nReview:");
  console.log(outcome.reviewText || "(empty)");
  if (outcome.staged.length) {
    console.log("\nStaged:");
    for (const s of outcome.staged) {
      console.log(`  - [${s.subsystem}] ${s.id}: ${s.summary}`);
    }
  } else {
    console.log("\n(no writes staged)");
  }
  if (outcome.errors.length) {
    console.log("\nErrors:");
    for (const e of outcome.errors) console.log(`  - ${e}`);
  }

  // ── Approve ──────────────────────────────────────────────────────────────
  console.log("\n=== Approve pending writes ===");
  const applied = await approveAllPending(runtime);
  if (applied.length) {
    for (const line of applied) console.log(`  applied ${line}`);
  } else {
    console.log("  (nothing pending)");
  }

  // ── Session 2 (fresh runtime, same volume) ───────────────────────────────
  console.log("\n=== Session 2 (recall) ===");
  const runtime2 = new AgentSessionRuntime({
    tenantId: "demo-user",
    fs,
    definition,
    origin: "foreground",
  });
  await runtime2.init();

  const prompt = runtime2.systemPrompt();
  const memorySection = prompt.includes("USER PROFILE") || prompt.includes("MEMORY (");
  console.log(`Frozen snapshot includes memory blocks: ${memorySection ? "yes" : "no"}`);
  if (prompt.includes("Nico") || prompt.includes("post-scheduler") || prompt.includes("bullet")) {
    console.log("Snapshot looks like it retained session-1 facts.");
  } else {
    console.log("Snapshot may not yet contain the spoken facts (model/curator dependent).");
  }

  const turn2 = await runAgentTurn(
    [{ role: "user", content: "What do you remember about me and how should you format answers?" }],
    { runtime: runtime2, model: MODEL },
  );
  console.log("\nAssistant:");
  console.log(turn2.text || "(no text)");

  console.log(`\n=== Done ===`);
  console.log(`AgentFS volume: ${volumePath}`);
  console.log("Re-run this script to keep the learned state across sessions.");

  await afs.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
