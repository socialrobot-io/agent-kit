# Skills & learning

How agents accumulate craft — and how a background curator teaches them under
human approval.

## Skills vs memory

| | Memory | Skills |
| - | ------ | ------ |
| Kind | Declarative ("who / what") | Procedural ("how to do this class of work") |
| Shape | Short entries in USER.md / MEMORY.md | A `SKILL.md` plus optional references, templates, scripts |
| Loaded | Always (frozen snapshot) | On demand, progressively |

A preference like "be terse" belongs in memory. A multi-step research workflow
belongs in a skill.

## Progressive disclosure

Skills stay cheap to browse:

1. **List** — name + description for every skill (small index).
2. **View** — open one skill's full body + a map of linked files.
3. **Drill** — load a specific reference, template, or script only when needed.

The model pays for what it reads, not for the whole library.

## What a skill looks like

```text
skills/
  concise-answers/
    SKILL.md
    references/     session detail, condensed notes
    templates/      starter files to copy
    scripts/        re-runnable probes / verifiers
```

`SKILL.md` follows the [agentskills.io](https://agentskills.io) shape: YAML
frontmatter (`name`, `description`, …) plus the procedure body.

## The curator

After a session, a background **curator** reviews the transcript with a
restricted toolset (memory + skill writes only). It looks for:

- Durable facts about the user → memory
- Reusable procedures and corrections → skills

It prefers **patching an existing umbrella skill** over creating narrow
one-off skills. It does **not** capture environment-dependent failures,
"this tool is broken" claims, or one-off task narratives — those harden into
bad long-term constraints.

## Human approval is the default for learning

When write-approval is on, every curator write is **staged**, not applied.

```text
session ends
   -> curator proposes memory + skill
   -> pending/{memory,skills}/
   -> human reviews
   -> approve (replay) or reject (discard)
   -> next session recalls only what was approved
```

Background learning without a human in the loop is how agents quietly train
themselves into weird corners. The gate exists so production agents get
smarter without going unsupervised.

## Why this is a moat (with the sandbox)

Self-improvement alone is not enough. Combined with
[tenant isolation](security.md) and the [sandbox](sandbox.md), you get agents
that:

- learn your brand's craft over time,
- never silently rewrite themselves,
- never share that craft across tenants,
- and never execute the wrong command while learning.
