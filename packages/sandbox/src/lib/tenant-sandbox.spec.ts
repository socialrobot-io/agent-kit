import { describe, it, expect } from "vitest";
import { TenantAgentFSSandbox } from "./tenant-sandbox.js";
import { InMemorySandboxAuditStore } from "./audit.js";
import type { CommandResult } from "bash-tool";

function makeFs() {
  const files = new Map<string, string>();
  return {
    async readFile(p: string) {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p)!;
    },
    async writeFile(p: string, c: string | Uint8Array) {
      files.set(p, typeof c === "string" ? c : new TextDecoder().decode(c));
    },
    files,
  };
}

describe("TenantAgentFSSandbox", () => {
  it("executes a benign command and audits it", async () => {
    const audit = new InMemorySandboxAuditStore();
    const calls: string[] = [];
    const sandbox = new TenantAgentFSSandbox({
      tenantId: "tenantA",
      audit,
      fs: makeFs(),
      executor: async (cmd: string): Promise<CommandResult> => {
        calls.push(cmd);
        return { stdout: "ok", stderr: "", exitCode: 0 };
      },
    });
    const res = await sandbox.executeCommand("echo hello > ./out.txt");
    expect(res.exitCode).toBe(0);
    expect(calls).toEqual(["echo hello > ./out.txt"]);
    const log = await audit.list("tenantA");
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe("bash");
    expect(log[0].filesTouched).toContain("./out.txt");
  });

  it("blocks a destructive command and records the block", async () => {
    const audit = new InMemorySandboxAuditStore();
    const sandbox = new TenantAgentFSSandbox({
      tenantId: "tenantA",
      audit,
      fs: makeFs(),
      executor: async () => ({ stdout: "should-not-run", stderr: "", exitCode: 0 }),
    });
    const res = await sandbox.executeCommand("rm -rf /");
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/destructive/i);
    const log = await audit.list("tenantA");
    expect(log[0].exitCode).toBe(1);
  });

  it("writes files into the tenant fs and audits paths", async () => {
    const audit = new InMemorySandboxAuditStore();
    const fs = makeFs();
    const sandbox = new TenantAgentFSSandbox({
      tenantId: "tenantA",
      audit,
      fs,
      executor: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    await sandbox.writeFiles([{ path: "skills/x/SKILL.md", content: "---\nname: x\n---" }]);
    expect(await fs.readFile("skills/x/SKILL.md")).toContain("name: x");
    const log = await audit.list("tenantA");
    expect(log[0].kind).toBe("writeFile");
    expect(log[0].filesTouched).toContain("skills/x/SKILL.md");
  });

  it("keeps tenants' audit logs separate", async () => {
    const audit = new InMemorySandboxAuditStore();
    const mk = (tenantId: string) =>
      new TenantAgentFSSandbox({
        tenantId,
        audit,
        fs: makeFs(),
        executor: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      });
    await mk("A").executeCommand("echo a");
    await mk("B").executeCommand("echo b");
    expect(await audit.list("A")).toHaveLength(1);
    expect(await audit.list("B")).toHaveLength(1);
    expect((await audit.list("A"))[0].subject).toBe("echo a");
  });

  it("scrubs secrets from command output", async () => {
    const sandbox = new TenantAgentFSSandbox({
      tenantId: "tenantA",
      fs: makeFs(),
      secrets: ["super-secret"],
      executor: async (): Promise<CommandResult> => ({
        stdout: "token=super-secret",
        stderr: "",
        exitCode: 0,
      }),
    });
    const res = await sandbox.executeCommand("echo token=super-secret");
    expect(res.stdout).toBe("token=***REDACTED***");
  });

  it("scrubs secrets from readFile results", async () => {
    const fs = makeFs();
    await fs.writeFile("/workspace/a.txt", "key=super-secret");
    const sandbox = new TenantAgentFSSandbox({
      tenantId: "tenantA",
      fs,
      secrets: ["super-secret"],
      executor: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    expect(await sandbox.readFile("/workspace/a.txt")).toBe("key=***REDACTED***");
  });
});
