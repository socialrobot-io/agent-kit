import { describe, it, expect, beforeEach } from "vitest";
import { FileSandboxAuditStore, type AuditFs } from "./audit.js";

class MemFs implements AuditFs {
  private files = new Map<string, string>();
  async readFile(path: string): Promise<string | null> {
    return this.files.has(path) ? this.files.get(path)! : null;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
}

describe("FileSandboxAuditStore", () => {
  let fs: MemFs;
  let store: FileSandboxAuditStore;

  beforeEach(() => {
    fs = new MemFs();
    store = new FileSandboxAuditStore({ fs });
  });

  it("appends and lists by tenant", async () => {
    await store.append({
      id: "",
      tenantId: "t1",
      kind: "guardrail_block",
      subject: "rm -rf /",
      exitCode: 1,
      createdAt: 1,
    });
    await store.append({
      id: "",
      tenantId: "t2",
      kind: "bash",
      subject: "ls",
      exitCode: 0,
      createdAt: 2,
    });
    const t1 = await store.list("t1");
    expect(t1).toHaveLength(1);
    expect(t1[0].kind).toBe("guardrail_block");
    expect(await store.list("t2")).toHaveLength(1);
  });
});
