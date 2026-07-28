import { describe, it, expect } from "vitest";
import { createTenantBashToolkit } from "./create-toolkit.js";

describe("createTenantBashToolkit", () => {
  it("exposes bash/readFile/writeFile tools and runs a safe command", async () => {
    const toolkit = await createTenantBashToolkit({
      tenantId: "t1",
      files: { "hello.txt": "hello from sandbox\n" },
    });

    expect(toolkit.tools.bash).toBeTruthy();
    expect(toolkit.tools.readFile).toBeTruthy();
    expect(toolkit.tools.writeFile).toBeTruthy();

    const listed = await toolkit.sandbox.executeCommand("ls /workspace && cat /workspace/hello.txt");
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("hello.txt");
    expect(listed.stdout).toContain("hello from sandbox");

    const audit = await toolkit.audit.list("t1");
    expect(audit.some((r) => r.kind === "bash")).toBe(true);
  });

  it("blocks destructive commands before just-bash runs", async () => {
    const toolkit = await createTenantBashToolkit({ tenantId: "t1" });
    const res = await toolkit.sandbox.executeCommand("rm -rf /");
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/destructive/i);
  });
});
