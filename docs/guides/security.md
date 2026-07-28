# Security & isolation

| Threat | Control |
| ------ | ------- |
| Prompt injection / promptware / exfil in memory or skills | Threat scan on write; re-scan into snapshot as `[BLOCKED: …]` |
| Destructive shell / secret dump / bad egress | [Sandbox](sandbox.md) guardrails + redaction |
| Silent self-modification | Write approval → `pending/` until human approve |
| Cross-tenant leak | One AgentFS volume per tenant; host binds auth → volume |

Auth and JWT/cookie checks are **your** job. See [Hosting](hosting.md).

## Write approval

When on (default in `defineAgent`):

- Curator and skill writes stage under `pending/{memory,skills}/`
- Approve replays; reject discards

```ts
import { AgentSessionRuntime, defineAgent, InMemoryFs, approvePendingWrites } from "@agent-kit/core";
import { applySkill } from "@agent-kit/curator";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});
await runtime.init();

// After the curator has staged writes into runtime.pending:
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

## Isolation (one volume per tenant)

| Isolated | Location |
| -------- | -------- |
| Files, pending | AgentFS volume |
| USER.md / MEMORY.md | `memories/` |
| Skills | `skills/` |
| Transcripts / FTS | Tenant-scoped store |
| Audit / snapshots | Per-volume |

Bash command examples and audit fields: [Sandbox](sandbox.md).
