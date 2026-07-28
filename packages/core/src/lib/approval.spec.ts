import { describe, it, expect, beforeEach } from "vitest";
import { evaluateGate, PendingWriteStore, skillGist } from "./approval.js";
import { InMemoryFs } from "./in-memory-fs.js";

const off = () => false;
const on = () => true;

describe("evaluateGate", () => {
  it("allows when the gate is off", () => {
    const d = evaluateGate("memory", { writeApprovalEnabled: off, origin: "foreground" });
    expect(d.kind).toBe("allow");
  });

  it("stages skills when gate is on and there is no inline channel", () => {
    const d = evaluateGate("skills", { writeApprovalEnabled: on, origin: "foreground" });
    expect(d.kind).toBe("stage");
  });

  it("stages background memory writes when gate is on", () => {
    const d = evaluateGate("memory", { writeApprovalEnabled: on, origin: "background_review" });
    expect(d.kind).toBe("stage");
  });

  it("stages foreground memory without an inline channel", () => {
    const d = evaluateGate("memory", { writeApprovalEnabled: on, origin: "foreground" });
    expect(d.kind).toBe("stage");
  });
});

describe("PendingWriteStore", () => {
  let fs: InMemoryFs;
  let store: PendingWriteStore;

  beforeEach(() => {
    fs = new InMemoryFs();
    store = new PendingWriteStore(fs);
  });

  it("stages and lists pending writes oldest-first", async () => {
    await store.stage("memory", { action: "add", target: "user", content: "a" }, { summary: "a", origin: "foreground" });
    const recs = await store.list("memory");
    expect(recs).toHaveLength(1);
    expect(recs[0].subsystem).toBe("memory");
    expect(recs[0].summary).toBe("a");
  });

  it("gets and discards a pending write", async () => {
    const rec = await store.stage("skills", { action: "create", name: "x" }, { summary: "create x", origin: "background_review" });
    expect(await store.get("skills", rec.id)).not.toBeNull();
    expect(await store.discard("skills", rec.id)).toBe(true);
    expect(await store.get("skills", rec.id)).toBeNull();
  });

  it("counts pending writes", async () => {
    await store.stage("memory", { action: "add" }, { summary: "1", origin: "foreground" });
    await store.stage("memory", { action: "add" }, { summary: "2", origin: "foreground" });
    expect(await store.count("memory")).toBe(2);
  });
});

describe("skillGist", () => {
  it("describes a create with frontmatter description", () => {
    const gist = skillGist("create", "foo", { content: "---\ndescription: Does things\n---\nbody" });
    expect(gist).toContain("create 'foo'");
    expect(gist).toContain("Does things");
  });

  it("describes a patch with line counts", () => {
    const gist = skillGist("patch", "foo", { old_string: "a\nb", new_string: "a\nb\nc" });
    expect(gist).toContain("patch 'foo' SKILL.md (+3/-2 lines)");
  });
});
