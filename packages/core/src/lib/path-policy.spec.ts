import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";
import { createAgentFs, PathPolicyError } from "./path-policy.js";
import { seedCompanyFiles } from "./seed-company.js";

describe("createAgentFs path policy", () => {
  it("denies writes under agent/", async () => {
    const raw = new InMemoryFs();
    await raw.writeFile("agent/SOUL.md", "identity");
    const agent = createAgentFs(raw);
    await expect(agent.writeFile("agent/SOUL.md", "hacked")).rejects.toBeInstanceOf(PathPolicyError);
    expect(await raw.readFile("agent/SOUL.md")).toBe("identity");
  });

  it("denies writes into locked skill folders and .locks.json", async () => {
    const raw = new InMemoryFs();
    await seedCompanyFiles(raw, {
      soul: "You are company bot.",
      skills: [
        {
          name: "billing-api",
          files: {
            "SKILL.md":
              "---\nname: billing-api\ndescription: Billing API.\nlocked: true\n---\n# Billing\n",
            "references/api.md": "# API\n",
          },
        },
      ],
    });
    const agent = createAgentFs(raw);
    await expect(agent.writeFile("skills/billing-api/SKILL.md", "nope")).rejects.toThrow(/locked/i);
    await expect(agent.writeFile("skills/billing-api/references/api.md", "nope")).rejects.toThrow(
      /locked/i,
    );
    await expect(agent.writeFile("skills/.locks.json", "{}")).rejects.toThrow(/immutable/i);
    expect(await raw.readFile("skills/billing-api/references/api.md")).toBe("# API\n");
  });

  it("denies FS writes when skill is locked only via frontmatter", async () => {
    const raw = new InMemoryFs();
    await raw.writeFile(
      "skills/safety/SKILL.md",
      "---\nname: safety\ndescription: Safety rules for the product.\npinned: true\n---\n# Safety\n",
    );
    const agent = createAgentFs(raw);
    await expect(agent.writeFile("skills/safety/references/x.md", "x")).rejects.toThrow(/locked/i);
  });

  it("allows memory writes on the agent-facing FS", async () => {
    const raw = new InMemoryFs();
    const agent = createAgentFs(raw);
    await agent.writeFile("memories/USER.md", "prefers short answers");
    expect(await agent.readFile("memories/USER.md")).toBe("prefers short answers");
  });
});
