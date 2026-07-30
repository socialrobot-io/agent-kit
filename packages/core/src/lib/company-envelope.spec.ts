/**
 * Company-envelope M1 acceptance specs (PRD P0.1–P0.11).
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";
import { createAgentFs, PathPolicyError } from "./path-policy.js";
import { seedCompanyFiles } from "./seed-company.js";
import { SkillLibrary } from "./skills.js";
import { scrubSecrets } from "./scrub-secrets.js";
import { loadSkillLocks, isSkillNameLocked } from "./skill-locks.js";
import { MemoryStore } from "./memory.js";
import { PendingWriteStore } from "./approval.js";
import { approvePendingWrites } from "./approve.js";
import { AgentSessionRuntime } from "./session-runtime.js";

const LOCKED_SKILL_MD =
  "---\nname: billing-api\ndescription: Company billing API skill.\nlocked: true\n---\n\n# Billing\n\nCall the billing API.\n";

async function seedLockedBilling(raw: InMemoryFs) {
  return seedCompanyFiles(raw, {
    soul: "You are company bot.",
    agentsMd: "Be brief.",
    skills: [
      {
        name: "billing-api",
        files: {
          "SKILL.md": LOCKED_SKILL_MD,
          "references/api.md": "# API\n",
          "scripts/run.sh": "#!/bin/sh\necho ok\n",
        },
      },
    ],
  });
}

describe("P0.1 / P0.2 company identity (agent FS)", () => {
  it("denies writes under agent/ and leaves content unchanged", async () => {
    const raw = new InMemoryFs();
    await seedCompanyFiles(raw, { soul: "identity", agentsMd: "rules" });
    const agent = createAgentFs(raw);

    await expect(agent.writeFile("agent/SOUL.md", "hacked")).rejects.toBeInstanceOf(PathPolicyError);
    await expect(agent.writeFile("agent/AGENTS.md", "hacked")).rejects.toThrow(/immutable/i);
    await expect(agent.writeFile("agent/extra.md", "x")).rejects.toThrow(/immutable/i);

    expect(await raw.readFile("agent/SOUL.md")).toBe("identity");
    expect(await raw.readFile("agent/AGENTS.md")).toBe("rules");
  });

  it("allows privileged raw volume to seed and update identity", async () => {
    const raw = new InMemoryFs();
    const { written } = await seedCompanyFiles(raw, {
      soul: "v1",
      agentsMd: "rules-v1",
    });
    expect(written).toEqual(expect.arrayContaining(["agent/SOUL.md", "agent/AGENTS.md"]));
    await raw.writeFile("agent/SOUL.md", "v2");
    expect(await raw.readFile("agent/SOUL.md")).toBe("v2");

    const agent = createAgentFs(raw);
    expect(await agent.readFile("agent/SOUL.md")).toBe("v2");
    await expect(agent.writeFile("agent/SOUL.md", "v3")).rejects.toThrow(/immutable/i);
  });

  it("denies deleteFile under agent/ when supported", async () => {
    const raw = new InMemoryFs();
    await raw.writeFile("agent/SOUL.md", "identity");
    const agent = createAgentFs(raw);
    await expect(agent.deleteFile!("agent/SOUL.md")).rejects.toThrow(/immutable/i);
    expect(await raw.readFile("agent/SOUL.md")).toBe("identity");
  });
});

describe("P0.3 / P0.4 locked skill mutations", () => {
  it("denies agent FS writes under locked skill folder and .locks.json", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const agent = createAgentFs(raw);

    await expect(agent.writeFile("skills/billing-api/SKILL.md", "nope")).rejects.toThrow(/locked/i);
    await expect(agent.writeFile("skills/billing-api/references/api.md", "nope")).rejects.toThrow(
      /locked/i,
    );
    await expect(agent.writeFile("skills/billing-api/scripts/run.sh", "nope")).rejects.toThrow(
      /locked/i,
    );
    await expect(agent.writeFile("skills/.locks.json", "{}")).rejects.toThrow(/immutable/i);
    await expect(agent.deleteFile!("skills/billing-api/references/api.md")).rejects.toThrow(
      /locked/i,
    );

    expect(await raw.readFile("skills/billing-api/references/api.md")).toBe("# API\n");
    expect(await raw.readFile("skills/billing-api/scripts/run.sh")).toContain("echo ok");
  });

  it("rejects every skill_manage mutation on a locked skill", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const skills = new SkillLibrary(createAgentFs(raw));

    const before = await raw.readFile("skills/billing-api/SKILL.md");

    expect((await skills.edit("billing-api", LOCKED_SKILL_MD.replace("Billing", "Hacked"))).success).toBe(
      false,
    );
    expect(
      (
        await skills.patch(
          "billing-api",
          "Call the billing API.",
          "Hacked.",
        )
      ).error,
    ).toMatch(/locked/i);
    expect((await skills.writeFile("billing-api", "references/x.md", "# x\n")).error).toMatch(
      /locked/i,
    );
    expect((await skills.removeFile("billing-api", "references/api.md")).error).toMatch(/locked/i);
    expect((await skills.deleteSkill("billing-api")).error).toMatch(/locked/i);
    expect(
      (
        await skills.create(
          "billing-api",
          "---\nname: billing-api\ndescription: Overwrite attempt for lock test.\n---\n\nBody.\n",
        )
      ).error,
    ).toMatch(/locked/i);

    expect(await raw.readFile("skills/billing-api/SKILL.md")).toBe(before);
    expect(await raw.readFile("skills/billing-api/references/api.md")).toBe("# API\n");
  });

  it("skill_manage refuses locked skills before staging", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const runtime = new AgentSessionRuntime({
      tenantId: "t1",
      fs: createAgentFs(raw),
      writeApprovalEnabled: () => true,
    });
    await runtime.init();
    const manage = runtime.tools().find((t) => t.name === "skill_manage")!;
    const res = (await manage.execute({
      action: "edit",
      name: "billing-api",
      content: LOCKED_SKILL_MD.replace("Billing", "Hacked"),
    })) as { success?: boolean; staged?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.staged).toBeFalsy();
    expect(res.error).toMatch(/locked/i);
    expect(await runtime.pending.count("skills")).toBe(0);
  });

  it("approvePendingWrites refuses locked skill targets without mutating disk", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const agent = createAgentFs(raw);
    const skills = new SkillLibrary(agent);
    const memory = new MemoryStore(agent);
    await memory.loadFromDisk();
    const pending = new PendingWriteStore(agent);

    await pending.stage(
      "skills",
      {
        action: "edit",
        name: "billing-api",
        content: LOCKED_SKILL_MD.replace("Billing", "Hacked"),
      },
      { summary: "edit locked", origin: "background_review" },
    );

    await expect(
      approvePendingWrites({ memory, skills, pending }),
    ).rejects.toThrow(/locked/i);

    expect(await raw.readFile("skills/billing-api/SKILL.md")).toBe(LOCKED_SKILL_MD);
    expect(await pending.count("skills")).toBe(1);
  });

});

describe("P0.5 lock marks", () => {
  it("locks via seed registry and cannot be cleared by agent frontmatter edit", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    expect(await loadSkillLocks(raw)).toContain("billing-api");
    expect(await isSkillNameLocked(raw, "billing-api")).toBe(true);

    const skills = new SkillLibrary(createAgentFs(raw));
    const unlockedAttempt = await skills.edit(
      "billing-api",
      "---\nname: billing-api\ndescription: Company billing API skill.\nlocked: false\n---\n\n# Billing\n\nCall the billing API.\n",
    );
    expect(unlockedAttempt.success).toBe(false);
    expect(await skills.isLocked("billing-api")).toBe(true);
  });

  it("treats pinned / bundled / locked frontmatter as locked for FS and API", async () => {
    for (const flag of ["pinned: true", "bundled: true", "locked: true"] as const) {
      const raw = new InMemoryFs();
      await raw.writeFile(
        "skills/safety/SKILL.md",
        `---\nname: safety\ndescription: Safety rules for the product.\n${flag}\n---\n\n# Safety\n`,
      );
      const agent = createAgentFs(raw);
      await expect(agent.writeFile("skills/safety/SKILL.md", "hacked")).rejects.toThrow(/locked/i);

      const skills = new SkillLibrary(agent);
      expect(await skills.isLocked("safety")).toBe(true);
      expect((await skills.deleteSkill("safety")).success).toBe(false);
    }
  });

  it("privileged raw FS can replace a locked skill folder", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const next =
      "---\nname: billing-api\ndescription: Company billing API skill.\n---\n\n# Billing v2\n";
    await raw.writeFile("skills/billing-api/SKILL.md", next);
    expect(await raw.readFile("skills/billing-api/SKILL.md")).toBe(next);
  });
});

describe("P0.6 list / view / create unlocked", () => {
  it("lists and views locked skills; creates a new unlocked skill name", async () => {
    const raw = new InMemoryFs();
    await seedLockedBilling(raw);
    const skills = new SkillLibrary(createAgentFs(raw));

    const listed = await skills.list();
    expect(listed.map((s) => s.name)).toContain("billing-api");
    const viewed = await skills.view("billing-api");
    expect(viewed.success).toBe(true);
    expect(viewed.content).toContain("Billing");

    const created = await skills.create(
      "billing-api-tenant-notes",
      "---\nname: billing-api-tenant-notes\ndescription: Tenant notes on billing.\n---\n\n# Notes\n",
    );
    expect(created.success).toBe(true);
    expect(await skills.isLocked("billing-api-tenant-notes")).toBe(false);
  });
});

describe("P0.7 memory / unlocked skills stay approval-friendly", () => {
  it("allows memory writes on agent-facing FS", async () => {
    const raw = new InMemoryFs();
    const agent = createAgentFs(raw);
    await agent.writeFile("memories/USER.md", "prefers short answers");
    expect(await agent.readFile("memories/USER.md")).toBe("prefers short answers");
  });

  it("approvePendingWrites still applies unlocked skill edits", async () => {
    const raw = new InMemoryFs();
    const agent = createAgentFs(raw);
    const skills = new SkillLibrary(agent);
    const memory = new MemoryStore(agent);
    await memory.loadFromDisk();
    const pending = new PendingWriteStore(agent);

    await skills.create(
      "concise",
      "---\nname: concise\ndescription: Prefer short answers always.\n---\n\n# Concise\n",
    );
    await pending.stage(
      "skills",
      {
        action: "edit",
        name: "concise",
        content:
          "---\nname: concise\ndescription: Prefer short answers always.\n---\n\n# Concise v2\n",
      },
      { summary: "edit concise", origin: "background_review" },
    );

    const applied = await approvePendingWrites({ memory, skills, pending });
    expect(applied.some((line) => line.includes("concise"))).toBe(true);
    expect(await raw.readFile("skills/concise/SKILL.md")).toContain("Concise v2");
  });
});

describe("P0.11 secret scrub on memory and skills", () => {
  it("redacts exact secrets and static credential shapes", () => {
    const text = scrubSecrets("token=super-secret-value and sk-abcdefghijklmnopqrstuvwxyz", [
      "super-secret-value",
    ]);
    expect(text).not.toContain("super-secret-value");
    expect(text).not.toMatch(/sk-[A-Za-z]+/);
    expect(text).toContain("***REDACTED***");
  });

  it("does not persist raw secrets in memory", async () => {
    const fs = new InMemoryFs();
    const memory = new MemoryStore(fs, { secrets: ["TENANT_SECRET_XYZ"] });
    await memory.loadFromDisk();
    const result = await memory.add("user", "API key is TENANT_SECRET_XYZ");
    expect(result.success).toBe(true);
    const raw = await fs.readFile("memories/USER.md");
    expect(raw).not.toContain("TENANT_SECRET_XYZ");
    expect(raw).toContain("***REDACTED***");
  });

  it("does not persist raw secrets in skill create/edit", async () => {
    const fs = new InMemoryFs();
    const skills = new SkillLibrary(fs, "", { secrets: ["TENANT_SECRET_XYZ"] });
    const created = await skills.create(
      "notes",
      "---\nname: notes\ndescription: Notes that mention secrets.\n---\n\nKey TENANT_SECRET_XYZ\n",
    );
    expect(created.success).toBe(true);
    expect(await fs.readFile("skills/notes/SKILL.md")).not.toContain("TENANT_SECRET_XYZ");

    const edited = await skills.edit(
      "notes",
      "---\nname: notes\ndescription: Notes that mention secrets.\n---\n\nStill TENANT_SECRET_XYZ\n",
    );
    expect(edited.success).toBe(true);
    expect(await fs.readFile("skills/notes/SKILL.md")).not.toContain("TENANT_SECRET_XYZ");
  });

  it("approvePendingWrites does not persist raw secrets in memory", async () => {
    const fs = new InMemoryFs();
    const memory = new MemoryStore(fs, { secrets: ["TENANT_SECRET_XYZ"] });
    await memory.loadFromDisk();
    const skills = new SkillLibrary(fs, "", { secrets: ["TENANT_SECRET_XYZ"] });
    const pending = new PendingWriteStore(fs);

    await pending.stage(
      "memory",
      { action: "add", target: "user", content: "Key TENANT_SECRET_XYZ" },
      { summary: "secret memory", origin: "background_review" },
    );

    await approvePendingWrites({ memory, skills, pending });
    expect(await fs.readFile("memories/USER.md")).not.toContain("TENANT_SECRET_XYZ");
    expect(await fs.readFile("memories/USER.md")).toContain("***REDACTED***");
  });
});
