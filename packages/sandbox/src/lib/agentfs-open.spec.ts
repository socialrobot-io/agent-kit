import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTenantVolume,
  openTenantVolume,
  resetAgentFsOpenCache,
  serializeAgentFs,
} from "./agentfs-open.js";
import { createTenantBashToolkit } from "./create-toolkit.js";

afterEach(() => {
  resetAgentFsOpenCache();
});

describe("openTenantVolume", () => {
  it("returns one volume with kit fs methods and agentFs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-vol-"));
    try {
      const volume = await openTenantVolume(join(dir, "tenant.db"));
      await volume.writeFile("agent/SOUL.md", "You are helpful.");
      expect(await volume.readFile("agent/SOUL.md")).toBe("You are helpful.");
      expect(await volume.list("agent")).toContain("SOUL.md");
      expect(volume.agentFs).toBeTruthy();
      expect(volume.agentFs.fs).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("single-flights the same path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-vol-"));
    try {
      const path = join(dir, "tenant.db");
      const [a, b] = await Promise.all([openTenantVolume(path), openTenantVolume(path)]);
      expect(a).toBe(b);
      expect(a.agentFs).toBe(b.agentFs);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializeAgentFs is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-vol-"));
    try {
      const volume = await openTenantVolume(join(dir, "tenant.db"));
      serializeAgentFs(volume.agentFs.fs);
      serializeAgentFs(volume.agentFs.fs);
      await volume.writeFile("x.txt", "ok");
      expect(await volume.readFile("x.txt")).toBe("ok");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("createTenantBashToolkit accepts volume", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-vol-"));
    try {
      const volume = await openTenantVolume(join(dir, "tenant.db"));
      const bash = await createTenantBashToolkit({
        tenantId: "t1",
        volume,
        files: { "hello.txt": "hi\n" },
        destination: "/workspace",
        defenseInDepth: false,
      });
      expect(bash.persisted).toBe(true);
      const listed = await bash.sandbox.executeCommand("cat /workspace/hello.txt");
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("createTenantVolume wraps an open handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-kit-vol-"));
    try {
      const volume = await openTenantVolume(join(dir, "tenant.db"));
      const again = createTenantVolume(volume.agentFs);
      await again.writeFile("y.txt", "y");
      expect(await volume.readFile("y.txt")).toBe("y");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
