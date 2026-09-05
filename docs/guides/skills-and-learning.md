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

`SKILL.md` follows [agentskills.io](https://agentskills.io):

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

## Locked skills

When a skill is locked, the whole folder is immutable to the agent, curator,
and approve replay. Agents may still `skills_list` / `skill_view`. They may
create **new learned** skills under other names (write approval still applies).

See [Security](security.md) for the three zones.

## Curator (propose updates after each turn)

If you use `createTenantHome`, you do not start the curator yourself. After
every completed turn, the home runs a background review. That review may
propose memory or skill changes. By default those proposals land under
`pending/` on the tenant volume. They are not live until a human approves
them. Set `curator.autoApprove: true` when your end users are not the right
reviewers (see below).

The review does not block the chat reply. It only uses `memory` and
`skill_manage` tools (no bash, no product tools).

```text
turn completes
  → curator runs in the background
  → default: proposals appear under pending/
  → your UI shows them; a human accepts or rejects
  → accept applies them to disk
  → the next chat session sees approved content
```

Default: on. Change it in `defineAgent`:

```ts
defineAgent({
  model: "anthropic/claude-sonnet-4-5",
  config: {
    curator: true, // default
    // curator: false,                      // never run after turns
    // curator: { mode: "memory" },         // only review memory
    // curator: { mode: "skills" },         // only review skills
    // curator: { autoApprove: true },      // apply curator proposals now
  },
});
```

| Capture | Skip |
| ------- | ---- |
| Durable user facts → memory | Failures that only happen in one environment |
| Reusable procedures → skills | “This tool is broken” one-offs |

### When end users should not review

Use `autoApprove` when the host product trusts the curator and end users are
not suited to accept or discard proposals. Curator writes apply immediately.
In-chat agent `memory` / `skill_manage` writes still follow `writeApproval`.

```ts
defineAgent({
  model: "anthropic/claude-sonnet-4-5",
  config: {
    writeApproval: { memory: true, skills: true },
    curator: { mode: "combined", autoApprove: true },
  },
});
```

| Posture | Config | Who decides |
| ------- | ------ | ----------- |
| Human review (default) | `writeApproval` on; curator without `autoApprove` | Operator or admin UI via `approvePendingWrites` |
| Trust curator | `curator: { autoApprove: true }` | Host at deploy time |
| Silent everything | `writeApproval: { memory: false, skills: false }` | Host; agent tool writes also apply immediately. Guidance and the `memory` tool description omit pending-approval copy. |

Skill locks, path locks, and threat scanning still apply when `autoApprove` is
on. See [Security](security.md).

## Review pending writes in your app

When you do not set `curator.autoApprove`, your job after the curator (or any
gated write) is to show `pending/` items and let a human decide.

**List what is waiting:**

```ts
const memoryPending = await session.pending.list("memory");
const skillPending = await session.pending.list("skills");
// Each item has id, summary, payload, origin, …
```

**Accept (apply to disk):**

```ts
import { approvePendingWrites } from "@socialrobot-io/agent-kit-core";

// Applies every pending memory and skill write, then removes those records.
const applied = await approvePendingWrites({
  memory: session.memory,
  skills: session.skills,
  pending: session.pending,
});
```

Approved content shows up in the **next** session’s frozen memory snapshot.
The chat that is already open does not change mid-turn.

**Reject (throw away):**

Do not call `approvePendingWrites`. Delete the staged record:

```ts
await session.pending.discard("memory", pendingId);
// or
await session.pending.discard("skills", pendingId);
```

**Locked skills:** if a proposal targets a locked skill folder, approve refuses
it and the volume stays unchanged.

## When the curator does not run by itself

`createTenantHome().openSession` wires the curator. If you only call
`openAgentSession` from `@socialrobot-io/agent-kit-ai` (no tenant home), nothing
starts the review for you. In that case call `runBackgroundReview` after the
turn. Example: [Models](models.md).

## Next

- [Security](security.md) — zones and locks
- [Hosting](hosting.md) — auth, volume, baked-in curator
- [Memory](memory.md) — frozen snapshot
