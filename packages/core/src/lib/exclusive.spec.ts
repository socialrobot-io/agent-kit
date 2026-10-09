import { describe, it, expect } from "vitest";
import { withExclusive, exclusiveFor, type ExclusiveFs } from "./exclusive.js";
import { InMemoryFs } from "./in-memory-fs.js";
import { MemoryStore } from "./memory.js";
import { SkillLibrary } from "./skills.js";
import { createAgentFs } from "./path-policy.js";

/** InMemoryFs plus a counting `exclusive`, like a shared backend would add. */
class LockingFs extends InMemoryFs implements ExclusiveFs {
  sections = 0;
  private readonly queue = exclusiveFor({});
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.sections++;
    return this.queue(fn);
  }
}

const skill = (name: string) =>
  `---\nname: ${name}\ndescription: Test skill.\n---\n\n# ${name}\n\nStep one.\n`;

describe("withExclusive", () => {
  it("uses the filesystem's own exclusive when present", async () => {
    const fs = new LockingFs();
    const out = await withExclusive(fs, async () => 42);
    expect(out).toBe(42);
    expect(fs.sections).toBe(1);
  });

  it("falls back to a process-local FIFO queue per fs object", async () => {
    const fs = new InMemoryFs();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const first = withExclusive(fs, async () => {
      order.push("first:start");
      await gate;
      order.push("first:end");
    });
    const second = withExclusive(fs, async () => {
      order.push("second");
    });

    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("propagates errors and keeps the queue usable", async () => {
    const fs = new InMemoryFs();
    await expect(
      withExclusive(fs, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withExclusive(fs, async () => "ok")).resolves.toBe("ok");
  });
});

describe("exclusive hook callers", () => {
  it("MemoryStore mutations run inside fs.exclusive", async () => {
    const fs = new LockingFs();
    const store = new MemoryStore(fs);
    await store.loadFromDisk();
    await store.add("memory", "Prefers short posts");
    await store.replace("memory", "short posts", "Prefers very short posts");
    await store.remove("memory", "very short");
    expect(fs.sections).toBe(3);
  });

  it("SkillLibrary create and patch run inside fs.exclusive", async () => {
    const fs = new LockingFs();
    const skills = new SkillLibrary(fs);
    const created = await skills.create("launch-thread", skill("launch-thread"));
    expect(created.success).toBe(true);
    const patched = await skills.patch("launch-thread", "Step one.", "Step one, then two.");
    expect(patched.success).toBe(true);
    expect(fs.sections).toBe(2);
  });

  it("the path-policy wrapper delegates to the inner store's lock", async () => {
    const inner = new LockingFs();
    const wrapped = createAgentFs(inner);
    await withExclusive(wrapped, async () => undefined);
    expect(inner.sections).toBe(1);
  });

  it("a wrapper and its inner volume share one process-local queue", async () => {
    const inner = new InMemoryFs();
    const wrapped = createAgentFs(inner);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const viaInner = withExclusive(inner, async () => {
      order.push("inner:start");
      await gate;
      order.push("inner:end");
    });
    const viaWrapper = withExclusive(wrapped, async () => {
      order.push("wrapper");
    });

    await Promise.resolve();
    release();
    await Promise.all([viaInner, viaWrapper]);
    expect(order).toEqual(["inner:start", "inner:end", "wrapper"]);
  });
});
