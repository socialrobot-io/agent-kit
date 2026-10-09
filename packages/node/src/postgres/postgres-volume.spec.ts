import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  MemoryStore,
  SkillLibrary,
  createAgentFs,
  withExclusive,
} from "@socialrobot-io/agent-kit-core";
import type { SqlClient } from "./sql.js";
import { PostgresVolume, normalizeVolumePath } from "./postgres-volume.js";
import { backends, runId, type OpenBackend } from "../../tests/pg-backends.js";

describe("normalizeVolumePath", () => {
  it("makes paths root-relative and resolves dot segments", () => {
    expect(normalizeVolumePath("/memories//USER.md")).toBe("memories/USER.md");
    expect(normalizeVolumePath("./skills/a/../b/SKILL.md")).toBe("skills/b/SKILL.md");
    expect(normalizeVolumePath("../../etc/passwd")).toBe("etc/passwd");
    expect(normalizeVolumePath("/")).toBe("");
  });

  it("rejects NUL bytes", () => {
    expect(() => normalizeVolumePath("a\u0000b")).toThrow(/NUL/);
  });
});

describe.each(backends)("PostgresVolume on $name", (backend) => {
  let open: OpenBackend;
  let db: SqlClient;
  let n = 0;
  /** Fresh tenant per test: tests share one database but never see each other. */
  const volume = () => new PostgresVolume({ db, tenantId: `vol-${runId}-${++n}` });

  beforeAll(async () => {
    open = await backend.open();
    db = open.db;
  });

  afterAll(async () => {
    await open?.close();
  });

  describe("filesystem contract", () => {
    it("returns null for a missing file and [] for a missing directory", async () => {
      const fs = volume();
      expect(await fs.readFile("memories/MEMORY.md")).toBeNull();
      expect(await fs.list("skills")).toEqual([]);
      expect(await fs.exists("skills")).toBe(false);
    });

    it("writes, overwrites, and reads files with or without a leading slash", async () => {
      const fs = volume();
      await fs.writeFile("/memories/USER.md", "one\n");
      expect(await fs.readFile("memories/USER.md")).toBe("one\n");
      await fs.writeFile("memories/USER.md", "two\n");
      expect(await fs.readFile("/memories/USER.md")).toBe("two\n");
      await fs.writeFile("memories/EMPTY.md", "");
      expect(await fs.readFile("memories/EMPTY.md")).toBe("");
    });

    it("lists direct children, with implicit directories", async () => {
      const fs = volume();
      await fs.writeFile("agent/SOUL.md", "x");
      await fs.writeFile("skills/a/SKILL.md", "x");
      await fs.writeFile("skills/a/references/r.md", "x");
      await fs.writeFile("skills/b/SKILL.md", "x");
      expect(await fs.list("")).toEqual(["agent", "skills"]);
      expect(await fs.list("/")).toEqual(["agent", "skills"]);
      expect(await fs.list("skills")).toEqual(["a", "b"]);
      expect(await fs.list("skills/a/")).toEqual(["SKILL.md", "references"]);
      expect(await fs.exists("skills/a")).toBe(true);
      expect(await fs.exists("skills/a/SKILL.md")).toBe(true);
    });

    it("does not match a sibling that shares a name prefix", async () => {
      const fs = volume();
      await fs.writeFile("skills/a/SKILL.md", "x");
      await fs.writeFile("skills/ab/SKILL.md", "x");
      expect(await fs.list("skills/a")).toEqual(["SKILL.md"]);
      await fs.deleteFile("skills/a");
      expect(await fs.readFile("skills/ab/SKILL.md")).toBe("x");
    });

    it("deletes a file, a directory, and ignores a missing path", async () => {
      const fs = volume();
      await fs.writeFile("pending/memory/1.json", "{}");
      await fs.writeFile("pending/memory/2.json", "{}");
      await fs.writeFile("pending/skills/3.json", "{}");
      await fs.deleteFile("pending/memory/1.json");
      expect(await fs.list("pending/memory")).toEqual(["2.json"]);
      await fs.deleteFile("pending");
      expect(await fs.list("pending")).toEqual([]);
      await expect(fs.deleteFile("nope/missing.md")).resolves.toBeUndefined();
    });

    it("renames files and directories, replacing the target", async () => {
      const fs = volume();
      await fs.writeFile("sessions/index.json.tmp", "new");
      await fs.writeFile("sessions/index.json", "old");
      await fs.rename("sessions/index.json.tmp", "sessions/index.json");
      expect(await fs.readFile("sessions/index.json")).toBe("new");
      expect(await fs.readFile("sessions/index.json.tmp")).toBeNull();

      await fs.writeFile("skills/draft/SKILL.md", "s");
      await fs.writeFile("skills/draft/references/r.md", "r");
      await fs.rename("skills/draft", "skills/final");
      expect(await fs.list("skills/final")).toEqual(["SKILL.md", "references"]);
      expect(await fs.readFile("skills/final/references/r.md")).toBe("r");
      expect(await fs.exists("skills/draft")).toBe(false);
    });

    it("throws ENOENT when renaming a missing path", async () => {
      const fs = volume();
      await expect(fs.rename("a.md", "b.md")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("refuses to write or delete the root", async () => {
      const fs = volume();
      await expect(fs.writeFile("/", "x")).rejects.toThrow(/root/);
      await expect(fs.deleteFile("")).rejects.toThrow(/root/);
    });

    it("keeps tenants apart in one table", async () => {
      const a = volume();
      const b = volume();
      await a.writeFile("memories/USER.md", "Likes tea");
      expect(await b.readFile("memories/USER.md")).toBeNull();
      expect(await b.list("")).toEqual([]);
      await b.deleteFile("memories");
      expect(await a.readFile("memories/USER.md")).toBe("Likes tea");
    });
  });

  describe("exclusive", () => {
    it("keeps every concurrent memory write (no lost updates)", async () => {
      const fs = volume();
      const stores = Array.from({ length: 4 }, () => new MemoryStore(fs));
      await Promise.all(stores.map((s) => s.loadFromDisk()));
      await Promise.all(
        Array.from({ length: 24 }, (_, i) => stores[i % stores.length]!.add("memory", `fact ${i}`)),
      );
      const check = new MemoryStore(fs);
      await check.loadFromDisk();
      expect(check.getEntries("memory")).toHaveLength(24);
    });

    it("rolls back the section's writes when it rejects", async () => {
      const fs = volume();
      await fs.writeFile("memories/MEMORY.md", "before");
      await expect(
        fs.exclusive(async () => {
          await fs.writeFile("memories/MEMORY.md", "during");
          expect(await fs.readFile("memories/MEMORY.md")).toBe("during");
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await fs.readFile("memories/MEMORY.md")).toBe("before");
    });

    it("is re-entrant for the same tenant", async () => {
      const fs = volume();
      const out = await fs.exclusive(() =>
        fs.exclusive(async () => {
          await fs.writeFile("a.md", "x");
          return fs.readFile("a.md");
        }),
      );
      expect(out).toBe("x");
    });

    it("serves the core policy wrapper and the skill library", async () => {
      const fs = volume();
      const agentFs = createAgentFs(fs);
      const skills = new SkillLibrary(agentFs);
      const body =
        "---\nname: launch-thread\ndescription: Write a launch thread.\n---\n\n# Steps\n\n1. Hook.\n";
      expect((await skills.create("launch-thread", body)).success).toBe(true);
      expect((await skills.patch("launch-thread", "1. Hook.", "1. Hook first.")).success).toBe(
        true,
      );
      expect(await fs.readFile("skills/launch-thread/SKILL.md")).toContain("Hook first.");
      await expect(agentFs.writeFile("agent/SOUL.md", "evil")).rejects.toThrow(/immutable/);
      await expect(withExclusive(agentFs, async () => "ok")).resolves.toBe("ok");
    });
  });
});
