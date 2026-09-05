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

  it("defaults writeApproval and curator to on", () => {
    const d = defineAgent({ model: "openai/gpt-5" });
    expect(d.config?.writeApproval).toEqual({ memory: true, skills: true });
    expect(d.config?.curator).toBe(true);
  });

  it("allows explicit writeApproval off", () => {
    const d = defineAgent({
      model: "openai/gpt-5",
      config: { writeApproval: { memory: false, skills: false } },
    });
    expect(d.config?.writeApproval).toEqual({ memory: false, skills: false });
  });

  it("allows explicit curator off, mode, or autoApprove", () => {
    expect(defineAgent({ model: "openai/gpt-5", config: { curator: false } }).config?.curator).toBe(
      false,
    );
    expect(
      defineAgent({ model: "openai/gpt-5", config: { curator: { mode: "memory" } } }).config
        ?.curator,
    ).toEqual({ mode: "memory", autoApprove: false });
    expect(
      defineAgent({
        model: "openai/gpt-5",
        config: { curator: { autoApprove: true } },
      }).config?.curator,
    ).toEqual({ mode: "combined", autoApprove: true });
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

  it("exposes the built-in tool surface", () => {
    expect(runtime.tools().map((t) => t.name)).toEqual(["memory", "skills_list", "skill_view", "skill_manage"]);
  });

  it("omits pending-approval copy when writeApproval is off", async () => {
    const silent = new AgentSessionRuntime({
      tenantId: "t1",
      fs,
      definition: defineAgent({
        model: "openai/gpt-5",
        config: { writeApproval: { memory: false, skills: false } },
      }),
    });
    await silent.init();
    const prompt = silent.systemPrompt();
    expect(prompt).toContain("# Memory");
    expect(prompt).not.toMatch(/staged:true/i);
    expect(prompt).not.toMatch(/pending approval/i);
    const mem = silent.tools().find((t) => t.name === "memory")!;
    expect(mem.description).not.toMatch(/staged:true/i);
    expect(mem.description).not.toMatch(/pending approval/i);
  });

  it("keeps pending-approval copy when writeApproval is on", async () => {
    const gated = new AgentSessionRuntime({
      tenantId: "t1",
      fs,
      definition: defineAgent({
        model: "openai/gpt-5",
        config: { writeApproval: { memory: true, skills: true } },
      }),
    });
    await gated.init();
    expect(gated.systemPrompt()).toMatch(/staged:true/i);
    expect(gated.tools().find((t) => t.name === "memory")!.description).toMatch(/pending approval/i);
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
    await manage.execute({
      action: "create",
      name: "research",
      content: "---\nname: research\ndescription: Research workflow steps.\n---\n\nSteps.\n",
    });
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
    const res = (await manage.execute({
      action: "create",
      name: "x",
      content: "---\nname: x\ndescription: Short skill for staging.\n---\n\nBody.\n",
    })) as { staged?: boolean };
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

    await approvePendingWrites({ memory: gated.memory, skills: gated.skills, pending: gated.pending });

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
