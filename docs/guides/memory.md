# Memory

| Store | Holds | Default budget |
| ----- | ----- | -------------- |
| **USER** | Role, preferences, style, expectations | 1,375 characters |
| **MEMORY** | Environment facts, conventions, tool quirks, lessons | 2,200 characters |

Files: `memories/USER.md`, `memories/MEMORY.md` on the tenant volume. Survive
across sessions. Tenant-scoped.

## Frozen snapshot

Injected into the system prompt **once** at session start. Keeps the
provider prefix cache hot across turns.

| When | Effect |
| ---- | ------ |
| Mid-session `memory` write | Hits disk now; **does not** change the running prompt |
| Next session | New snapshot includes approved disk state |
| Every HTTP turn | **Do not** rebuild the snapshot (kills prefix cache) |
| `memory` `action=list` | Reads live disk; does not mutate the prompt |

| Surface | Session boundary |
| ------- | ---------------- |
| CLI / long-lived process | Process / conversation lifetime |
| Example app | One `useChat` id; **New chat** = new session |

Budgets are characters, not tokens. Full store → write rejected; consolidate
then add in one batch.

## Save vs skip

| Save | Skip |
| ---- | ---- |
| Stable prefs ("terse answers", "TypeScript") | One-off task narratives |
| Repeated corrections | Transient TODOs |
| Durable env facts / conventions | Raw dumps; procedures → [skills](skills-and-learning.md) |

Writes are threat-scanned. See [Security](security.md).
