# Memory

What the agent remembers — and why remembering does not blow your token bill.

## Two stores

| Store | Holds | Default budget |
| ----- | ----- | -------------- |
| **USER** | Who the user is — role, preferences, style, expectations | 1,375 characters |
| **MEMORY** | What the agent has learned — environment facts, conventions, tool quirks, lessons | 2,200 characters |

Both live as files in the tenant's agent home (`memories/USER.md`,
`memories/MEMORY.md`). They survive across sessions. They are scoped to that
tenant only.

## Frozen snapshots (why this stays cheap)

Memory is injected into the system prompt **once**, at session start, as a
frozen snapshot.

Mid-session writes still hit disk immediately (durable), but they do **not**
change the running prompt. The next session is the first time they appear.

That is intentional:

- Your provider's **prefix cache stays hot** for the whole session.
- A 40-message conversation does not pay to re-process a growing memory block
  on every turn.
- The agent still "remembers" — just at the right grain.

## Bounded and high-signal

Budgets are in characters (model-independent), not tokens. When a store is
full, new writes are rejected with the current entries and clear guidance:
consolidate first, then add — in one atomic batch.

The result is a short, curated profile — not an endless chat log stuffed into
the prompt.

## What belongs in memory

**Save**

- Stable preferences ("wants terse answers", "prefers TypeScript")
- Corrections the user had to make more than once
- Durable environment facts and conventions

**Skip**

- One-off task narratives
- Transient TODO state
- Raw data dumps
- Reusable procedures (those belong in a [skill](skills-and-learning.md))

## Safety

Memory content is threat-scanned before it can enter the system prompt. See
[Security & isolation](security.md).
