# Skills & learning

Two kinds of lasting knowledge, and two host-visible skill sources:

| | Memory | Skills |
| - | ------ | ------ |
| Kind | Facts about the user and environment | Procedures (how to do a job) |
| Shape | Lines in `USER.md` / `MEMORY.md` | A folder with `SKILL.md` plus optional files |
| Loaded into the prompt | Always, via the frozen memory snapshot | Only when the model lists and opens them |

Read [Memory](memory.md) first if you have not.

## Skill sources

| Source | Where it comes from | Locked? |
| ------ | ------------------- | ------- |
| **Agent-folder** | Host `agent/skills/<name>/` | **No**, unless marked (see below). |
| **Learned** | Agent or curator on the live volume | **No.** Write approval still applies by default. |

**Mark an agent-folder skill locked** (whole folder immutable):

1. Frontmatter: `locked: true` (or `pinned: true` / `bundled: true`), or
2. Sidecar file: `agent/skills/<name>/.locked`

```text
agent/
  SOUL.md
  AGENTS.md
  skills/
    team-notes/           ← editable under approval
      SKILL.md
    billing-api/          ← locked via frontmatter or .locked
      SKILL.md
      .locked             ← optional marker
      references/
```

Compile and install via home:

```ts
import { compileAgent, createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

await compileAgent({ dir: "./agent", outFile: "./src/generated/agent.ts" });

const home = await createTenantHome({ tenantId, agent });
```

The durable copy lives on the AgentFS volume after install.
## Skill layout

```text
skills/
  concise-answers/
    SKILL.md
    references/     optional
    templates/      optional
    scripts/        optional
```

`SKILL.md` follows [agentskills.io](https://agentskills.io) (Hermes-compatible
create rules):

```text
---
name: concise-answers
description: Answer tersely when asked.
---

# Concise answers

1. Lead with the answer.
2. Skip preamble.
```

Required frontmatter: `name` and `description`. `name` must match the skill
folder (lowercase letters, numbers, hyphens, dots, underscores; max 64). New
skills need a short description (60 chars or fewer, trigger first) so the
skill index keeps routing signal. Put longer detail in the body. Optional
support files live under `references/`, `templates/`, `scripts/`, or `assets/`.

How the model loads a skill (progressive disclosure):

1. `skills_list`: name + description only
2. `skill_view`: full `SKILL.md` plus a `linked_files` map and `skill_dir`
3. `skill_view` with `file_path`: one linked file, only when needed

## Locked skills (any tier)

When a skill is locked, the whole folder is immutable to the agent, curator,
and approve replay. Agents may still `skills_list` / `skill_view`. They may
create **new learned** skills under other names (write approval still applies).

See [Security](security.md) for the three zones.

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

## Approve pending writes

```ts
import { approvePendingWrites } from "@socialrobot-io/agent-kit-core";

const applied = await approvePendingWrites({
  memory: session.memory,
  skills: session.skills,
  pending: session.pending,
});
```

Reject means discard the staged files. Do not call `approvePendingWrites`.

Locked skill targets are refused (disk unchanged).

## Next

- [Security](security.md) — zones and locks
- [Hosting](hosting.md) — `company` on `createTenantHome`
- [Memory](memory.md) — frozen snapshot
