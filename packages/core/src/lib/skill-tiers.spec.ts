/**
 * Skill tier acceptance: framework (always locked), agent-folder (unlocked
 * unless marked), learned (runtime, unlocked).
 */
import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";
import { createAgentFs } from "./path-policy.js";
import { seedCompanyFiles } from "./seed-company.js";
import { SkillLibrary } from "./skills.js";
import { isSkillNameLocked, loadSkillLocks, SKILL_LOCK_MARKER } from "./skill-locks.js";

describe("skill tiers", () => {
  it("framework-tier skills are always locked", async () => {
    const raw = new InMemoryFs();
    const { locked } = await seedCompanyFiles(raw, {
      skills: [
        {
          name: "kit-helper",
          tier: "framework",
          files: {
            "SKILL.md":
              "---\nname: kit-helper\ndescription: Framework helper skill body.\n---\n\n# Helper\n",
          },
        },
      ],
    });
    expect(locked).toContain("kit-helper");
    expect(await loadSkillLocks(raw)).toContain("kit-helper");
    const skills = new SkillLibrary(createAgentFs(raw));
    expect(await skills.isLocked("kit-helper")).toBe(true);
    expect((await skills.edit("kit-helper", "x")).success).toBe(false);
  });

  it("agent-folder skills stay unlocked when unmarked", async () => {
    const raw = new InMemoryFs();
    const { locked } = await seedCompanyFiles(raw, {
      skills: [
        {
          name: "team-notes",
          tier: "agent",
          files: {
            "SKILL.md":
              "---\nname: team-notes\ndescription: Team notes skill for authors.\n---\n\n# Notes\n",
          },
        },
      ],
    });
    expect(locked).not.toContain("team-notes");
    expect(await isSkillNameLocked(raw, "team-notes")).toBe(false);
    const skills = new SkillLibrary(createAgentFs(raw));
    const edited = await skills.edit(
      "team-notes",
      "---\nname: team-notes\ndescription: Team notes skill for authors.\n---\n\n# Notes v2\n",
    );
    expect(edited.success).toBe(true);
  });

  it("agent-folder skills lock via frontmatter or .locked marker", async () => {
    const raw = new InMemoryFs();
    await seedCompanyFiles(raw, {
      skills: [
        {
          name: "via-fm",
          tier: "agent",
          files: {
            "SKILL.md":
              "---\nname: via-fm\ndescription: Locked via frontmatter flag.\nlocked: true\n---\n\n# A\n",
          },
        },
        {
          name: "via-marker",
          tier: "agent",
          files: {
            "SKILL.md":
              "---\nname: via-marker\ndescription: Locked via sidecar marker.\n---\n\n# B\n",
            [SKILL_LOCK_MARKER]: "",
          },
        },
      ],
    });
    expect(await isSkillNameLocked(raw, "via-fm")).toBe(true);
    expect(await isSkillNameLocked(raw, "via-marker")).toBe(true);
    const agent = createAgentFs(raw);
    await expect(agent.writeFile("skills/via-marker/SKILL.md", "nope")).rejects.toThrow(/locked/i);
  });

  it("learned skills created at runtime are unlocked", async () => {
    const raw = new InMemoryFs();
    await seedCompanyFiles(raw, {
      skills: [
        {
          name: "kit-helper",
          tier: "framework",
          files: {
            "SKILL.md":
              "---\nname: kit-helper\ndescription: Framework helper skill body.\n---\n\n# Helper\n",
          },
        },
      ],
    });
    const skills = new SkillLibrary(createAgentFs(raw));
    const created = await skills.create(
      "tenant-workflow",
      "---\nname: tenant-workflow\ndescription: Learned tenant workflow skill.\n---\n\n# Workflow\n",
    );
    expect(created.success).toBe(true);
    expect(await skills.isLocked("tenant-workflow")).toBe(false);
    expect(await skills.isLocked("kit-helper")).toBe(true);
  });
});
