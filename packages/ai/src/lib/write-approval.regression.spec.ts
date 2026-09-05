/**
 * Regression: interactive write approval must apply after human OK,
 * not stage-and-claim-done.
 *
 * Failure mode (example chat): memory remove returned staged:true while the
 * model told the user the 1+1=3 rule was already deleted.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolSet } from "ai";
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import {
  AgentSessionRuntime,
  defineAgent,
  InMemoryFs,
  MEMORY_SCHEMA,
  MEMORY_GUIDANCE,
  memoryToolDescription,
  SESSION_SEARCH_GUIDANCE,
} from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "./open-session.js";
import { createWriteToolApproval } from "./write-tool-approval.js";

async function resolveApproval(
  status: ReturnType<typeof createWriteToolApproval>,
  toolName: "memory" | "skill_manage",
  input: unknown,
): Promise<string | undefined> {
  if (!status) return undefined;
  const entry = (status as Record<string, unknown>)[toolName];
  if (entry == null) return undefined;
  if (typeof entry === "string") return entry;
  if (typeof entry === "function") {
    const result = await (
      entry as (
        value: unknown,
        opts: {
          toolCallId: string;
          messages: never[];
          toolContext: never;
          runtimeContext: never;
        },
      ) => Promise<unknown>
    )(input, {
      toolCallId: "t1",
      messages: [],
      toolContext: undefined as never,
      runtimeContext: undefined as never,
    });
    if (result == null) return "not-applicable";
    if (typeof result === "string") return result;
    if (typeof result === "object" && result !== null && "type" in result) {
      return String((result as { type: unknown }).type);
    }
    return undefined;
  }
  if (typeof entry === "object" && entry !== null && "type" in entry) {
    return String((entry as { type: unknown }).type);
  }
  return undefined;
}

const fakeSessionSearch: SessionTool = {
  name: "session_search",
  description: "search",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ success: true, mode: "browse", sessions: [] }),
};

describe("createWriteToolApproval", () => {
  it("requires user approval for mutating memory and skill_manage", async () => {
    const approval = createWriteToolApproval({ memory: true, skills: true });
    expect(approval).toBeTruthy();
    expect(await resolveApproval(approval, "memory", { action: "add", target: "user", content: "x" })).toBe(
      "user-approval",
    );
    expect(await resolveApproval(approval, "memory", { action: "remove", target: "user", old_text: "x" })).toBe(
      "user-approval",
    );
    expect(await resolveApproval(approval, "memory", { action: "list", target: "user" })).toBe(
      "not-applicable",
    );
    expect(await resolveApproval(approval, "skill_manage", { action: "create", name: "x" })).toBe(
      "user-approval",
    );
  });

  it("returns undefined when both gates are off", () => {
    expect(createWriteToolApproval({ memory: false, skills: false })).toBeUndefined();
  });

  it("can enable only memory", async () => {
    const approval = createWriteToolApproval({ memory: true, skills: false });
    expect((approval as Record<string, unknown> | undefined)?.skill_manage).toBeUndefined();
    expect(await resolveApproval(approval, "memory", { action: "add", target: "user", content: "y" })).toBe(
      "user-approval",
    );
  });
});

describe("interactive write approval regression", () => {
  let fs: InMemoryFs;

  beforeEach(async () => {
    fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are concise.");
    await fs.writeFile("agent/AGENTS.md", "Be brief.");
  });

  it("interactiveApproval pairs toolApproval with promptInline apply", async () => {
    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({
        model: "mock/model",
        config: { writeApproval: { memory: true, skills: true } },
      }),
      interactiveApproval: true,
    });

    expect(session.writeToolApproval).toBeTruthy();
    expect(
      await resolveApproval(session.writeToolApproval, "memory", {
        action: "add",
        target: "user",
        content: "x",
      }),
    ).toBe("user-approval");

    const mem = session.runtime.tools().find((t) => t.name === "memory")!;
    await mem.execute({ action: "add", target: "user", content: "paired write" });
    expect(session.runtime.memory.getEntries("user")).toContain("paired write");
  });

  it("applies memory remove after promptInline grants (AI SDK approve path)", async () => {
    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({
        model: "mock/model",
        config: { writeApproval: { memory: true, skills: true } },
      }),
      // Simulates: AI SDK already got Approve before execute runs.
      promptInline: async () => true,
    });

    const mem = session.runtime.tools().find((t) => t.name === "memory")!;
    await mem.execute({ action: "add", target: "user", content: "From now on 1 + 1 = 3" });
    expect(session.runtime.memory.getEntries("user")).toContain("From now on 1 + 1 = 3");

    const removed = (await mem.execute({
      action: "remove",
      target: "user",
      old_text: "1 + 1 = 3",
    })) as { success?: boolean; staged?: boolean };

    expect(removed.staged).toBeUndefined();
    expect(removed.success).toBe(true);
    expect(session.runtime.memory.getEntries("user")).not.toContain("From now on 1 + 1 = 3");
    expect(await session.runtime.pending.count("memory")).toBe(0);
  });

  it("stages memory remove when there is no interactive channel (background / no UI)", async () => {
    const ungated = new AgentSessionRuntime({
      tenantId: "demo-user",
      fs,
      writeApprovalEnabled: () => false,
    });
    await ungated.init();
    await ungated
      .tools()
      .find((t) => t.name === "memory")!
      .execute({ action: "add", target: "user", content: "From now on 1 + 1 = 3" });

    const runtime = new AgentSessionRuntime({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({
        model: "mock/model",
        config: { writeApproval: { memory: true, skills: true } },
      }),
    });
    await runtime.init();

    const mem = runtime.tools().find((t) => t.name === "memory")!;
    const res = (await mem.execute({
      action: "remove",
      target: "user",
      old_text: "1 + 1 = 3",
    })) as { staged?: boolean; message?: string };

    expect(res.staged).toBe(true);
    expect(res.message).toMatch(/Not yet saved/i);
    expect(runtime.memory.getEntries("user")).toContain("From now on 1 + 1 = 3");
  });

  it("blocks the write when promptInline denies", async () => {
    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({
        model: "mock/model",
        config: { writeApproval: { memory: true, skills: false } },
      }),
      promptInline: async () => false,
    });

    const mem = session.runtime.tools().find((t) => t.name === "memory")!;
    const res = (await mem.execute({
      action: "add",
      target: "user",
      content: "should not land",
    })) as { success?: boolean; error?: string; staged?: boolean };

    expect(res.success).toBe(false);
    expect(res.staged).toBeUndefined();
    expect(res.error).toMatch(/denied/i);
    expect(session.runtime.memory.getEntries("user")).toHaveLength(0);
  });

  it("applies skill_manage after promptInline grants", async () => {
    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({
        model: "mock/model",
        config: { writeApproval: { memory: true, skills: true } },
      }),
      promptInline: async () => true,
    });

    const manage = session.runtime.tools().find((t) => t.name === "skill_manage")!;
    const res = (await manage.execute({
      action: "create",
      name: "concise",
      content: "---\nname: concise\ndescription: Answer tersely when asked.\n---\n\nLead with the answer.\n",
    })) as { success?: boolean; staged?: boolean };

    expect(res.staged).toBeUndefined();
    expect(res.success).toBe(true);
    expect((await session.runtime.skills.list()).map((s) => s.name)).toContain("concise");
  });
});

describe("openAgentSession guidance pairing regression", () => {
  it("injects session_search + sandbox guidance when those tools are wired", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are concise.");

    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({ model: "mock/model" }),
      sessionSearchTool: fakeSessionSearch,
      sandboxTools: {
        bash: { description: "run", inputSchema: { type: "object" }, execute: async () => ({}) },
      } as unknown as ToolSet,
    });

    const prompt = session.runtime.systemPrompt();
    expect(prompt).toContain("# Memory");
    expect(prompt).toContain("# Session search");
    expect(prompt).toContain(SESSION_SEARCH_GUIDANCE.slice(0, 48));
    expect(prompt).toContain("# Sandbox");
    expect(session.builtinTools.map((t) => t.name)).toContain("session_search");
  });

  it("omits session_search guidance when the tool is not wired", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("agent/SOUL.md", "You are concise.");
    const session = await openAgentSession({
      tenantId: "demo-user",
      fs,
      definition: defineAgent({ model: "mock/model" }),
    });
    expect(session.runtime.systemPrompt()).not.toContain("# Session search");
  });
});

describe("tool schema copy regression", () => {
  it("memory schema and guidance forbid claiming staged writes as saved", () => {
    expect(MEMORY_SCHEMA.description).toMatch(/staged:true/i);
    expect(MEMORY_SCHEMA.description).toMatch(/pending approval/i);
    expect(MEMORY_GUIDANCE).toMatch(/staged:true/i);
  });

  it("memory tool description drops pending copy when the gate is off", () => {
    const off = memoryToolDescription(false);
    expect(off).not.toMatch(/staged:true/i);
    expect(off).not.toMatch(/pending approval/i);
    expect(off).toMatch(/TARGETS/i);
  });

  it("session_search guidance forbids inventing prior chats and scrolling current", () => {
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/Do not invent/i);
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/browse/i);
    expect(SESSION_SEARCH_GUIDANCE).toMatch(/current/i);
  });
});
