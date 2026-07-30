# Security & isolation

Login checks (JWT, cookies, sessions) are **your** job. See
[Hosting](hosting.md).

agent-kit enforces a **company envelope** in code: company identity and locked
skills cannot be rewritten by the agent, while tenants still adapt through
approved memory and unlocked skills.

Product requirements: [Company envelope PRD](../roadmap/company-envelope-prd.md).

## Core controls

- **Three zones** — Immutable · Approval-gated · Free (see table below)
- **Path policy** — Sessions use `createAgentFs(volume)`. Writes under `agent/` and locked `skills/<name>/` fail
- **Skill tiers** — Framework always locked; agent-folder unlocked unless marked; learned unlocked
- **Threat scanning** — Memory and skill writes scanned before they can enter a future prompt
- **Secret scrubbing** — Host `secrets` and common credential shapes redacted from tool output and learning writes
- **Write approval** — Unlocked memory/skill writes stage under `pending/` by default
- **Sandbox guardrails** — Destructive bash, exfil patterns, and non-allowlisted hosts blocked
- **Tenant isolation** — One AgentFS volume (and audit trail) per `tenantId`

## Three zones

| Zone | Paths / surface | Agent may |
| ---- | --------------- | --------- |
| Immutable | `agent/SOUL.md`, `agent/AGENTS.md`, locked skill folders | Read / use only |
| Approval-gated | `memories/*`, unlocked skills | Propose via tools; apply after gate |
| Free | `/workspace`, allowed bash, allowed tools | Work under guardrails |

Hosts install identity and skills on the **raw** volume via
`createTenantHome({ agent })` (from `compileAgent`). Sessions already use a
policy-wrapped FS.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId,
  agent,
  sandbox: {
    secrets: [process.env.TENANT_API_KEY!],
    allowedHosts: ["api.company.com"],
  },
});
```

## Locked skills

| Source | Lock rule |
| ------ | --------- |
| Agent-folder (`agent/skills`) | Locked only if frontmatter `locked`/`pinned`/`bundled` or `.locked` file |
| Learned (runtime) | Never locked at creation |

Locked folders use the agentskills layout. Internal processes cannot change
them: `skill_manage`, curator, approve replay, or agent-facing FS writes.
View/list still work. New learned skills use other names (behind write approval).

Full table: [Skills & learning](skills-and-learning.md).

## Threats and controls

| Risk | What the kit does |
| ---- | ----------------- |
| Bad text in memory or skills | Scan on write. Poisoned entries show as `[BLOCKED: …]` in the snapshot |
| Secrets in tool output or learning | Scrub configured `secrets` and common credential shapes |
| Dangerous shell / unexpected network | [Sandbox](sandbox.md) blocks before run; secrets redacted on command line and output |
| Agent rewriting company identity or locked skills | Path policy + skill locks deny in code |
| Agent quietly rewriting unlocked memory/skills | Write approval stages under `pending/` until a human approves |
| One customer reading another’s data | One AgentFS volume per tenant; your app binds login → `tenantId` → volume |

## Write approval

On by default in `defineAgent`.

| Gate | When |
| ---- | ---- |
| Staging (`pending/`) | Background curator, or chat turns without interactive approval |
| Interactive (AI SDK UI) | Chat UI Approve/Deny before a write runs |

```ts
const home = await createTenantHome({
  tenantId,
  interactiveApproval: true,
});
const session = await home.openSession(sessionId);
```

Do not pass only `createWriteToolApproval` without `interactiveApproval` (or an
equivalent `promptInline: async () => true`). UI Approve alone will still stage.

```ts
import { approvePendingWrites } from "@socialrobot-io/agent-kit-core";

const applied = await approvePendingWrites({
  memory: session.memory,
  skills: session.skills,
  pending: session.pending,
});
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
