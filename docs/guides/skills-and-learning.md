# Skills & learning

| | Memory | Skills |
| - | ------ | ------ |
| Kind | Declarative (who / what) | Procedural (how) |
| Shape | Entries in USER.md / MEMORY.md | `SKILL.md` + optional refs/templates/scripts |
| Loaded | Always (frozen snapshot) | On demand: list → view → drill |

## Layout

```text
skills/
  concise-answers/
    SKILL.md
    references/
    templates/
    scripts/
```

`SKILL.md` follows [agentskills.io](https://agentskills.io): YAML frontmatter
(`name`, `description`, …) + procedure body.

Tools: `skills_list` → `skill_view` → load a linked file only when needed.

## Curator

After a session, `runBackgroundReview` uses memory + skill write tools only.

| Capture | Skip |
| ------- | ---- |
| Durable user facts → memory | Env-dependent failures |
| Reusable procedures / corrections → skills | "This tool is broken" |
| Prefer patching an umbrella skill | One-off task narratives |

## Approve

When write-approval is on, curator writes stage; they are not applied.

```text
session ends
  → curator proposes
  → pending/{memory,skills}/
  → human approve (replay) or reject (discard)
  → next session snapshot uses approved only
```

```ts
import type { ModelMessage } from "ai";
import {
  AgentSessionRuntime,
  defineAgent,
  InMemoryFs,
  approvePendingWrites,
} from "@agent-kit/core";
import { applySkill, runBackgroundReview } from "@agent-kit/curator";
import { aiCuratorRunner } from "@agent-kit/ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});
await runtime.init();

const transcript: ModelMessage[] = [
  { role: "user", content: "Stop being so verbose." },
  { role: "assistant", content: "Understood." },
];

await runBackgroundReview(transcript, {
  memory: runtime.memory,
  skills: runtime.skills,
  pending: runtime.pending,
  writeApprovalEnabled: () => true,
  mode: "combined",
  model: aiCuratorRunner("anthropic/claude-haiku-4-5"),
});

const applied = await approvePendingWrites(
  {
    memory: runtime.memory,
    skills: runtime.skills,
    pending: runtime.pending,
  },
  applySkill,
);
console.log(applied);
```
