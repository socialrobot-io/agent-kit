import { describe, it, expect, beforeEach } from "vitest";
import { AgentSessionRuntime } from "./session-runtime.js";
import { defineAgent } from "./agent.js";
import { InMemoryFs } from "./in-memory-fs.js";

const SOUL = "You are a helpful research agent.";
const AGENTS = "Always cite sources.";

describe("defineAgent", () => {
  it("requires a model", () => {
    expect(() => defineAgent({ model: "" })).toThrow();
    expect(defineAgent({ model: "openai/gpt-5" }).model).toBe("openai/gpt-5");
  });
});

describe("AgentSessionRuntime", () => {
  let fs: InMemoryFs;
  let runtime: AgentSessionRuntime;

  beforeEach(async () => {
    fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", SOUL);
    await fs.writeFile("agent/AGENTS.md", AGENTS);
    runtime = new AgentSessionRuntime({ tenantId: "t1", fs });
    await runtime.init();
  });

  it("builds a system prompt from SOUL + AGENTS.md", () => {
    const prompt = runtime.systemPrompt();
    expect(prompt).toContain(SOUL);
    expect(prompt).toContain(AGENTS);
  });

  it("exposes the Hermes tool surface", () => {
    expect(runtime.tools().map((t) => t.name)).toEqual(["memory", "skills_list", "skill_view", "skill_manage"]);
  });

  it("wires real JSON schemas onto tools (not empty objects)", () => {
    const mem = runtime.tools().find((t) => t.name === "memory")!;
    expect(mem.inputSchema.type).toBe("object");
    expect(mem.inputSchema.properties).toBeTruthy();
    expect((mem.inputSchema.properties as Record<string, unknown>).action).toBeTruthy();
    expect((mem.inputSchema.properties as Record<string, unknown>).content).toBeTruthy();
    expect(mem.inputSchema.required).toContain("target");

    const manage = runtime.tools().find((t) => t.name === "skill_manage")!;
    expect((manage.inputSchema.properties as Record<string, unknown>).action).toBeTruthy();
    expect(manage.inputSchema.required).toEqual(expect.arrayContaining(["action", "name"]));
  });

  it("memory tool writes are reflected in the next session's snapshot", async () => {
    const mem = runtime.tools().find((t) => t.name === "memory")!;
    await mem.execute({ action: "add", target: "user", content: "User prefers terse replies" });

    // Same-session snapshot is frozen (no new entry).
    expect(runtime.systemPrompt()).not.toContain("terse replies");

    // New session reloads from disk -> entry appears.
    const next = new AgentSessionRuntime({ tenantId: "t1", fs });
    await next.init();
    expect(next.systemPrompt()).toContain("terse replies");
  });

  it("refreshMemory updates the frozen snapshot in-place", async () => {
    const mem = runtime.tools().find((t) => t.name === "memory")!;
    await mem.execute({ action: "add", target: "user", content: "User goes by Batman" });
    expect(runtime.systemPrompt()).not.toContain("Batman");
    await runtime.refreshMemory();
    expect(runtime.systemPrompt()).toContain("Batman");
  });

  it("memory action=list returns live entries", async () => {
    const mem = runtime.tools().find((t) => t.name === "memory")!;
    await mem.execute({ action: "add", target: "user", content: "User goes by Batman" });
    const listed = (await mem.execute({ action: "list", target: "user" })) as {
      success: boolean;
      entries: string[];
    };
    expect(listed.success).toBe(true);
    expect(listed.entries).toContain("User goes by Batman");
  });

  it("skill_manage creates a skill that skills_list then shows", async () => {
    const manage = runtime.tools().find((t) => t.name === "skill_manage")!;
    await manage.execute({ action: "create", name: "research", content: "---\ndescription: Research workflow\n---\nSteps." });
    const list = runtime.tools().find((t) => t.name === "skills_list")!;
    const res = (await list.execute({})) as { skills: { name: string }[] };
    expect(res.skills.map((s) => s.name)).toContain("research");
  });

  it("stages memory writes when write_approval is on", async () => {
    const gated = new AgentSessionRuntime({
      tenantId: "t1",
      fs,
      writeApprovalEnabled: () => true,
    });
    await gated.init();
    const mem = gated.tools().find((t) => t.name === "memory")!;
    const res = (await mem.execute({ action: "add", target: "user", content: "staged fact" })) as { staged?: boolean };
    expect(res.staged).toBe(true);
    expect(await gated.pending.count("memory")).toBe(1);
    expect(gated.memory.getEntries("user")).toHaveLength(0);
  });

  it("stages skill writes when write_approval is on", async () => {
    const gated = new AgentSessionRuntime({
      tenantId: "t1",
      fs,
      writeApprovalEnabled: () => true,
    });
    await gated.init();
    const manage = gated.tools().find((t) => t.name === "skill_manage")!;
    const res = (await manage.execute({ action: "create", name: "x", content: "---\ndescription: x\n---" })) as { staged?: boolean };
    expect(res.staged).toBe(true);
    expect(await gated.pending.count("skills")).toBe(1);
    expect((await gated.skills.list())).toHaveLength(0);
  });

  it("approvePendingWrites applies operations batches into the next snapshot", async () => {
    const { approvePendingWrites } = await import("./approve.js");
    const { applyMemoryArgs } = await import("./memory.js");

    const gated = new AgentSessionRuntime({
      tenantId: "t1",
      fs,
      writeApprovalEnabled: () => true,
    });
    await gated.init();

    await gated.pending.stage(
      "memory",
      {
        target: "user",
        operations: [
          { action: "add", content: "User is Nico" },
          { action: "add", content: "Prefers short bullet-point answers" },
        ],
      },
      { summary: "batch: User is Nico", origin: "background_review" },
    );

    // Broken approve (action-only) would discard without writing.
    const broken = await gated.pending.list("memory");
    expect(broken[0].payload.action).toBeUndefined();
    expect(Array.isArray(broken[0].payload.operations)).toBe(true);

    await approvePendingWrites(
      { memory: gated.memory, skills: gated.skills, pending: gated.pending },
      async () => undefined,
    );

    expect(await gated.pending.count("memory")).toBe(0);
    expect(gated.memory.getEntries("user")).toEqual(
      expect.arrayContaining(["User is Nico", "Prefers short bullet-point answers"]),
    );

    const next = new AgentSessionRuntime({ tenantId: "t1", fs });
    await next.init();
    expect(next.systemPrompt()).toContain("User is Nico");
    expect(next.systemPrompt()).toContain("Prefers short bullet-point answers");

    // Malformed freeform payloads must fail loudly, not silently discard.
    const bad = await applyMemoryArgs(gated.memory, {
      target: "user",
      name: "Nico",
      prefers: "bullets",
    });
    expect(bad.success).toBe(false);
  });
});
