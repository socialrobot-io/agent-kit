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

Memory and skill writes do not become live until a human accepts them. That
gate is **on by default** (`defineAgent` sets `config.writeApproval` for both
memory and skills).

### What happens when the agent wants to write

Without a chat Approve button wired up, the kit **stages** the change under
`pending/` on the tenant volume. The open chat’s memory snapshot does not
change. A human reviews later.

Typical sources of staged writes:

- The agent calling `memory` / `skill_manage` during a normal turn
- The background curator after a turn

### Option A: Approve later (default)

1. List items with `session.pending.list("memory")` / `"skills"`.
2. Show them in your ops UI.
3. Accept with `approvePendingWrites`, or reject with `session.pending.discard`.

```ts
import { approvePendingWrites } from "@socialrobot-io/agent-kit-core";

// Accept everything currently staged for this tenant session’s stores.
await approvePendingWrites({
  memory: session.memory,
  skills: session.skills,
  pending: session.pending,
});
```

Full list / accept / reject API: [Skills & learning](skills-and-learning.md).

### Option B: Approve in the chat UI

Turn on interactive approval so the AI SDK UI can show Approve / Deny on the
write tool call **before** it applies:

```ts
const home = await createTenantHome({
  tenantId,
  agent,
  interactiveApproval: true, // required for in-chat Approve to apply
});
```

`interactiveApproval: true` does two things together:

1. Asks the UI for Approve / Deny on write tools.
2. Tells the kit that a UI Approve should **apply** the write (not stage again).

If you only attach AI SDK `toolApproval` / `createWriteToolApproval` and skip
`interactiveApproval` (or an equivalent `promptInline: async () => true`), a
UI Approve still ends up **staged** under `pending/`. Use the home flag above.

### Turn the gate off

Only when you intentionally want silent applies:

```ts
defineAgent({
  model: "anthropic/claude-sonnet-4-5",
  config: { writeApproval: { memory: false, skills: false } },
});
```

Do not do this for multi-tenant production unless you accept silent self-edits.

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
