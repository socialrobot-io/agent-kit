# Security & isolation

This guide lists what agent-kit tries to stop, and what your app must still do.

Login checks (JWT, cookies, sessions) are **your** job. See
[Hosting](hosting.md).

## Threats and controls

| Risk | What the kit does |
| ---- | ----------------- |
| Bad text in memory or skills (prompt injection, promptware, exfil patterns) | Scan on write. Poisoned entries show as `[BLOCKED: …]` in the snapshot |
| Dangerous shell, secret dump, unexpected network | [Sandbox](sandbox.md) blocks the command before it runs; secrets can be redacted |
| Agent quietly rewriting itself | Write approval stages changes under `pending/` until a human approves |
| One customer reading another’s data | One AgentFS volume per tenant; your app binds login → `tenantId` → volume |

## Write approval

On by default in `defineAgent`.

There are two related gates:

| Gate | When |
| ---- | ---- |
| Staging (`pending/`) | Background curator, or chat turns without interactive approval |
| Interactive (AI SDK UI) | Chat UI Approve/Deny before a write runs |

For chat UIs, enable both sides with one flag:

```ts
const session = await openAgentSession({
  tenantId,
  fs: volume,
  definition,
  interactiveApproval: true,
});
// session.stream / session.run attach toolApproval.
// After the user Approves in the UI, the write applies (not staged again).
```

Do not pass only `createWriteToolApproval` without `interactiveApproval` (or an
equivalent `promptInline: async () => true`). UI Approve alone will still stage.

Curator / ops approve of staged files:

```ts
import {
  approvePendingWrites,
  defineAgent,
  InMemoryFs,
} from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";
import { applySkill } from "@socialrobot-io/agent-kit-curator";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const session = await openAgentSession({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});

// After the curator has staged files into session.runtime.pending:
const applied = await approvePendingWrites(
  {
    memory: session.runtime.memory,
    skills: session.runtime.skills,
    pending: session.runtime.pending,
  },
  applySkill,
);
```

Full curator + approve flow: [Skills & learning](skills-and-learning.md).

## What stays isolated per tenant

| Data | Where |
| ---- | ----- |
| Files and pending writes | That tenant’s AgentFS volume |
| `USER.md` / `MEMORY.md` | `memories/` on that volume |
| Skills | `skills/` on that volume |
| Chat transcripts and search | Tenant-scoped transcript store |
| Audit and snapshots | Per volume |

Shell examples and audit fields: [Sandbox](sandbox.md).

## Next

- Host checklist: [Hosting](hosting.md)
- Sandbox guardrails: [Sandbox](sandbox.md)
