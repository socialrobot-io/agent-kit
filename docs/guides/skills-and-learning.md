# Skills & learning

Two kinds of lasting knowledge:

| | Memory | Skills |
| - | ------ | ------ |
| Kind | Facts about the user and environment | Procedures (how to do a job) |
| Shape | Lines in `USER.md` / `MEMORY.md` | A folder with `SKILL.md` plus optional files |
| Loaded into the prompt | Always, via the frozen memory snapshot | Only when the model lists and opens them |

Read [Memory](memory.md) first if you have not.

## Skill layout

```text
skills/
  concise-answers/
    SKILL.md
    references/     optional
    templates/      optional
    scripts/        optional
```

`SKILL.md` follows [agentskills.io](https://agentskills.io): YAML frontmatter
(`name`, `description`, and related fields) plus the procedure body.

How the model loads a skill:

1. `skills_list`: see what exists
2. `skill_view`: open one `SKILL.md`
3. Open a linked file only when needed

## Curator (propose updates after a chat)

The curator is a separate background pass. It reads a transcript and may
propose memory or skill writes. It does not run your full chat toolset.

```text
chat ends
  → runBackgroundReview (curator)
  → files under pending/memory and pending/skills
  → human approves or rejects
  → next session snapshot uses approved content only
```

| Capture | Skip |
| ------- | ---- |
| Durable user facts → memory | Failures that only happen in one environment |
| Reusable procedures → skills | “This tool is broken” one-offs |
| Prefer updating an existing umbrella skill | Long narratives of a single task |

## Approve (make proposals real)

When write approval is on (the default), curator output is staged. It is not
applied until a human approves.

```ts
import type { ModelMessage } from "ai";
import {
  AgentSessionRuntime,
  defineAgent,
  InMemoryFs,
  approvePendingWrites,
} from "@socialrobot-io/agent-kit-core";
import { applySkill, runBackgroundReview } from "@socialrobot-io/agent-kit-curator";
import { aiCuratorRunner } from "@socialrobot-io/agent-kit-ai";

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

// Only after a human accepts the staged files:
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

Reject means discard the staged files. Do not call `approvePendingWrites`.

## Next

- Threat scan and isolation: [Security](security.md)
- Host wiring for pending review in your UI: [Hosting](hosting.md)
