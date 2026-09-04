import { describe, expect, it } from "vitest";
import {
  AGENT_KIT_AGENTS_DIR_ENV,
  AGENT_KIT_SERVER_EXTERNAL_PACKAGES,
  agentsTraceGlob,
  withAgentKit,
  type AgentKitNextConfig,
} from "./with-agent-kit.js";

describe("agentsTraceGlob", () => {
  it("defaults-style paths become ./agents/**/*", () => {
    expect(agentsTraceGlob("agents")).toBe("./agents/**/*");
    expect(agentsTraceGlob("./agents")).toBe("./agents/**/*");
    expect(agentsTraceGlob("agents/")).toBe("./agents/**/*");
  });

  it("allows nested relative dirs", () => {
    expect(agentsTraceGlob("src/agents")).toBe("./src/agents/**/*");
  });

  it("rejects absolute and parent paths", () => {
    expect(() => agentsTraceGlob("/var/agents")).toThrow(/relative/);
    expect(() => agentsTraceGlob("../agents")).toThrow(/simple relative/);
    expect(() => agentsTraceGlob("")).toThrow(/non-empty/);
  });
});

describe("withAgentKit", () => {
  it("merges defaults for agents next to app/", () => {
    const cfg = withAgentKit({} as AgentKitNextConfig);
    expect(cfg.serverExternalPackages).toEqual([...AGENT_KIT_SERVER_EXTERNAL_PACKAGES]);
    expect(cfg.outputFileTracingIncludes).toEqual({
      "/*": ["./agents/**/*"],
    });
    expect(cfg.env?.[AGENT_KIT_AGENTS_DIR_ENV]).toBe("agents");
  });

  it("keeps host config and appends agentsDir", () => {
    const cfg = withAgentKit(
      {
        serverExternalPackages: ["sharp"],
        outputFileTracingIncludes: {
          "/*": ["./public/data/**/*"],
          "/api/chat": ["./extra/**/*"],
        },
        env: { OTHER: "1" },
        experimental: { foo: true },
      },
      { agentsDir: "src/agents", serverExternalPackages: ["better-sqlite3"] },
    );

    expect(cfg.serverExternalPackages).toEqual([
      ...AGENT_KIT_SERVER_EXTERNAL_PACKAGES,
      "better-sqlite3",
      "sharp",
    ]);
    expect(cfg.outputFileTracingIncludes).toEqual({
      "/*": ["./public/data/**/*", "./src/agents/**/*"],
      "/api/chat": ["./extra/**/*"],
    });
    expect(cfg.env).toEqual({
      OTHER: "1",
      [AGENT_KIT_AGENTS_DIR_ENV]: "src/agents",
    });
    expect(cfg.experimental).toEqual({ foo: true });
  });

  it("does not duplicate when already configured", () => {
    const cfg = withAgentKit({
      serverExternalPackages: ["agentfs-sdk"],
      outputFileTracingIncludes: { "/*": ["./agents/**/*"] },
    });
    expect(cfg.serverExternalPackages?.filter((p) => p === "agentfs-sdk")).toHaveLength(1);
    expect(cfg.outputFileTracingIncludes?.["/*"]).toEqual(["./agents/**/*"]);
  });
});
