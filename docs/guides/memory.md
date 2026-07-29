# Memory

Memory is short, durable text the agent should remember across chats for one
tenant. It lives in two files on that tenant’s volume:

| File | Holds | Default size limit |
| ---- | ----- | ------------------ |
| `memories/USER.md` | Who the user is: role, preferences, style, expectations | 1,375 characters |
| `memories/MEMORY.md` | Environment facts, conventions, tool quirks, lessons | 2,200 characters |

Limits are character counts, not tokens. If a store is full, the write is
rejected. Consolidate first, then add in one batch.

Parallel chats for one tenant share the same volume. Memory
`add` / `replace` / `remove` / `applyBatch` run one at a time per volume so
concurrent writers do not overwrite each other. The frozen system-prompt
snapshot for each open chat still does not change mid-session.

## Frozen snapshot (why mid-chat writes feel “delayed”)

When a session starts, the kit copies memory into the system prompt **once**.
That copy is the frozen snapshot for this chat.

| Event | What happens |
| ----- | ------------ |
| Session starts | Snapshot is built from disk and put in the system prompt |
| Model calls `memory` and writes | File on disk updates now |
| Same open session continues | System prompt still uses the old snapshot |
| New session starts | New snapshot includes what is on disk (after approval rules) |
| `memory` with `action=list` | Reads live disk. Does not change the prompt |

Why freeze it: many model providers cache the start of the system prompt.
If you rebuild the snapshot on every HTTP request, that cache breaks and cost
goes up.

| Where you run | What counts as one session |
| ------------- | -------------------------- |
| Long-lived process or CLI | One process or one conversation |
| Example chat app | One `useChat` id. “New chat” starts a new session |

## What to save vs skip

| Save | Skip |
| ---- | ---- |
| Stable prefs (“prefer short answers”, “TypeScript”) | One-off task stories |
| Corrections the user repeats | Temporary TODOs |
| Durable environment facts | Raw dumps. Step-by-step procedures belong in [skills](skills-and-learning.md) |

Every write is threat-scanned before it can enter a future prompt. See
[Security](security.md).

## Next

- Skills and the approve loop: [Skills & learning](skills-and-learning.md)
- Wire a tenant volume: [Hosting](hosting.md)
