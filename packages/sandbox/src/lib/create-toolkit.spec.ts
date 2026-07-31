import { describe, it, expect } from "vitest";
import { defineCommand } from "just-bash";
import {
  createTenantBashToolkit,
  resolveDefenseInDepth,
  toAbsoluteSeedFiles,
  toJustBashNetwork,
} from "./create-toolkit.js";

describe("createTenantBashToolkit helpers", () => {
  it("maps relative seed files under destination", () => {
    expect(toAbsoluteSeedFiles({ "a.txt": "x", "/abs.txt": "y" }, "/workspace")).toEqual({
      "/workspace/a.txt": "x",
      "/abs.txt": "y",
    });
  });

  it("builds just-bash network allowlist from hosts", () => {
    expect(toJustBashNetwork(["api.example.com"])).toEqual({
      allowedUrlPrefixes: ["https://api.example.com", "http://api.example.com"],
      allowedMethods: ["GET", "HEAD"],
    });
    expect(toJustBashNetwork([])).toBeUndefined();
    expect(toJustBashNetwork(undefined)).toBeUndefined();
  });

  it("keeps DefenseInDepth off under Next, auto otherwise", () => {
    const prevRuntime = process.env.NEXT_RUNTIME;
    const prevOrigin = process.env.__NEXT_PRIVATE_ORIGIN;
    delete process.env.NEXT_RUNTIME;
    delete process.env.__NEXT_PRIVATE_ORIGIN;
    expect(resolveDefenseInDepth()).toEqual({ enabled: "auto" });
    expect(resolveDefenseInDepth(false)).toBe(false);

    process.env.NEXT_RUNTIME = "nodejs";
    expect(resolveDefenseInDepth()).toBe(false);
    delete process.env.NEXT_RUNTIME;

    if (prevRuntime !== undefined) process.env.NEXT_RUNTIME = prevRuntime;
    if (prevOrigin !== undefined) process.env.__NEXT_PRIVATE_ORIGIN = prevOrigin;
  });
});

describe("createTenantBashToolkit", () => {
  it("exposes bash/readFile/writeFile tools and runs a safe command", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      files: { "hello.txt": "hello from sandbox\n" },
      defenseInDepth: false,
    });

    expect(toolkit.tools.bash).toBeTruthy();
    expect(toolkit.tools.readFile).toBeTruthy();
    expect(toolkit.tools.writeFile).toBeTruthy();
    expect(toolkit.bash).toBeTruthy();

    const listed = await toolkit.sandbox.executeCommand("ls /workspace && cat /workspace/hello.txt");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("hello.txt");
    expect(listed.stdout).toContain("hello from sandbox");

    // Seed files land on the just-bash FS via the Bash constructor.
    const viaBash = await toolkit.bash.exec("cat /workspace/hello.txt");
    expect(viaBash.stdout).toContain("hello from sandbox");

    const audit = await toolkit.audit.list("t1");
    expect(audit.some((r) => r.kind === "bash")).toBe(true);
  });

  it("blocks destructive commands before just-bash runs", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
    });
    const res = await toolkit.sandbox.executeCommand("rm -rf /");
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/destructive/i);
  });

  it("does not register curl when network is disabled", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
    });
    const res = await toolkit.bash.exec("curl -s https://example.com");
    expect(res.exitCode).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/command not found|not found|curl/i);
  });

  it("leaves js-exec and python3 unavailable by default", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
    });
    const js = await toolkit.bash.exec('js-exec -c "console.log(1)"');
    expect(js.exitCode).not.toBe(0);
    expect(`${js.stdout}${js.stderr}`).toMatch(/command not found|not found|js-exec/i);

    const py = await toolkit.bash.exec('python3 -c "print(1)"');
    expect(py.exitCode).not.toBe(0);
    expect(`${py.stdout}${py.stderr}`).toMatch(/command not found|not found|python/i);
  });

  it("runs js-exec when javascript is enabled", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
      javascript: true,
    });
    const res = await toolkit.bash.exec('js-exec -c "console.log(1 + 2)"');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("3");
  });

  it("runs js-exec on a persisted AgentFS volume when javascript is enabled", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { AgentFS } = await import("agentfs-sdk");

    const dir = await mkdtemp(join(tmpdir(), "agent-kit-sandbox-js-"));
    const volumePath = join(dir, "tenant.db");
    try {
      const afs = await AgentFS.open({ path: volumePath });
      const toolkit = await createTenantBashToolkit({
        tenantId: "t1",
        agentFs: afs,
        defenseInDepth: false,
        javascript: true,
      });
      const res = await toolkit.bash.exec('js-exec -c "console.log(1 + 2)"');
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("3");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("runs python3 when python is enabled", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
      python: true,
    });
    const res = await toolkit.bash.exec('python3 -c "print(1 + 2)"');
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("3");
  });

  it("registers customCommands from defineCommand", async () => {
    const hello = defineCommand("hello", async (args) => ({
      stdout: `Hello, ${args[0] || "world"}!\n`,
      stderr: "",
      exitCode: 0,
    }));
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      defenseInDepth: false,
      customCommands: [hello],
    });
    const res = await toolkit.bash.exec("hello Alice");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Hello, Alice!");
  });

  it("registers customCommands on a persisted AgentFS volume", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { AgentFS } = await import("agentfs-sdk");
    const hello = defineCommand("hello", async (args) => ({
      stdout: `Hello, ${args[0] || "world"}!\n`,
      stderr: "",
      exitCode: 0,
    }));

    const dir = await mkdtemp(join(tmpdir(), "agent-kit-sandbox-cmd-"));
    try {
      const afs = await AgentFS.open({ path: join(dir, "tenant.db") });
      const toolkit = await createTenantBashToolkit({
        tenantId: "t1",
        agentFs: afs,
        defenseInDepth: false,
        customCommands: [hello],
      });
      const res = await toolkit.bash.exec("hello Alice");
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("Hello, Alice!");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("persists workspace files into an AgentFS volume when agentFs is set", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { AgentFS } = await import("agentfs-sdk");

    const dir = await mkdtemp(join(tmpdir(), "agent-kit-sandbox-"));
    const volumePath = join(dir, "tenant.db");
    try {
      const afs = await AgentFS.open({ path: volumePath });
      const toolkit = await createTenantBashToolkit({
        tenantId: "t1",
        agentFs: afs,
        defenseInDepth: false,
        files: { "seed.txt": "seeded\n" },
      });
      expect(toolkit.persisted).toBe(true);

      const wrote = await toolkit.sandbox.executeCommand(
        "mkdir -p /workspace/villains && echo 'Why so serious?' > /workspace/villains/joker.md",
      );
      expect(wrote.exitCode).toBe(0);

      const listed = await toolkit.sandbox.executeCommand(
        "ls /workspace/villains && cat /workspace/villains/joker.md && cat /workspace/seed.txt",
      );
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("joker.md");
      expect(listed.stdout).toContain("Why so serious?");
      expect(listed.stdout).toContain("seeded");

      // Fresh toolkit over the same volume must see the write.
      const again = await createTenantBashToolkit({
        tenantId: "t1",
        agentFs: afs,
        defenseInDepth: false,
      });
      const againListed = await again.sandbox.executeCommand(
        "ls /workspace/villains && cat /workspace/villains/joker.md",
      );
      expect(againListed.exitCode).toBe(0);
      expect(againListed.stdout).toContain("joker.md");
      expect(againListed.stdout).toContain("Why so serious?");

      // Raw AgentFS paths keep the /workspace prefix for easy browsing.
      const raw = await afs.fs.readFile("/workspace/villains/joker.md", "utf8");
      expect(raw).toContain("Why so serious?");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
