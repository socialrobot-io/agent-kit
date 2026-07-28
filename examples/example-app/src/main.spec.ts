/**
 * Offline smoke test for the self-improvement flywheel (no network, no AgentFS).
 */

import { describe, it, expect } from "vitest";
import { AgentSessionRuntime, defineAgent, InMemoryFs } from "@agent-kit/core";
import { runBackgroundReview } from "@agent-kit/curator";
import { aiCuratorRunner, runAgentTurn } from "@agent-kit/ai";
import { approveAllPending } from "./approve.js";
import { mockModel, textStep, toolCallStep } from "./mock-model.js";

const USER_FACT = "User is Nico; prefers short bullet-point answers; main project is post-scheduler";

describe("example-app flywheel (offline)", () => {
  it("session saves memory, curator stages, approve applies, session 2 recalls", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are a friendly personal assistant.");
    await fs.writeFile("agent/AGENTS.md", "Prefer short answers.");

    // Session memory applies immediately so we can assert getEntries after the turn.
    // Curator still stages behind writeApprovalEnabled: () => true.
    const definition = defineAgent({
      model: "mock",
      config: { writeApproval: { memory: false, skills: false } },
    });

    const runtime = new AgentSessionRuntime({
      tenantId: "demo-user",
      fs,
      definition,
      origin: "foreground",
    });
    await runtime.init();

    const sessionModel = mockModel([
      toolCallStep("memory", { action: "add", target: "user", content: USER_FACT }),
      textStep("Got it, Nico. I'll keep answers in short bullets."),
    ]);

    const turn = await runAgentTurn(
      [
        {
          role: "user",
          content:
            "Hi! I'm Nico. I prefer short bullet-point answers, and my main project is post-scheduler. Remember that.",
        },
      ],
      { runtime, model: sessionModel },
    );

    expect(turn.toolCalls.some((c) => c.name === "memory")).toBe(true);
    expect(runtime.memory.getEntries("user")).toContain(USER_FACT);

    const curatorModel = mockModel([
      toolCallStep(
        "memory",
        { action: "add", target: "user", content: "Prefers bullet-point formatting" },
        "c1",
      ),
      toolCallStep(
        "skill_manage",
        {
          action: "create",
          name: "nico-bullets",
          content: "---\ndescription: Answer Nico in bullets\n---\nUse short bullets.",
        },
        "c2",
      ),
      textStep("Staged a preference and a skill."),
    ]);

    const conversation = [
      {
        role: "user" as const,
        content: "Hi! I'm Nico. I prefer short bullet-point answers.",
      },
      { role: "assistant" as const, content: turn.text },
    ];

    const outcome = await runBackgroundReview(conversation, {
      memory: runtime.memory,
      skills: runtime.skills,
      pending: runtime.pending,
      writeApprovalEnabled: () => true,
      mode: "combined",
      model: aiCuratorRunner(curatorModel),
    });

    expect(outcome.staged.length).toBeGreaterThan(0);
    expect(outcome.applied.length).toBe(0);

    const applied = await approveAllPending(runtime);
    expect(applied.length).toBeGreaterThan(0);
    expect(await runtime.pending.count("memory")).toBe(0);
    expect(await runtime.pending.count("skills")).toBe(0);

    const runtime2 = new AgentSessionRuntime({
      tenantId: "demo-user",
      fs,
      definition,
      origin: "foreground",
    });
    await runtime2.init();

    expect(runtime2.systemPrompt()).toContain(USER_FACT);
  });
});
