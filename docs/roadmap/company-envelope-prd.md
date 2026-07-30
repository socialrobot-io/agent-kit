# PRD: Company envelope (curated free agents)

**Status:** M1 shipped in-tree (zones, locked skills, secret scrubbing). P1/P2 still open.  
**Audience:** product + maintainers of agent-kit and apps that embed it

---

## 1. One-sentence summary

Companies must be able to ship agents that feel free to their users, while the kit hard-enforces a company-defined identity, locked skill folders, tool set, and learning boundary that internal processes cannot rewrite.

## 2. Problem

Before the company envelope, agent-kit already supported per-tenant volumes,
frozen memory, write approval, threat scans, and bash guardrails. That was not
enough for a company product.

| Company expectation | Gap without envelope enforcement |
| ------------------- | -------------------------------- |
| “Our SOUL and operating rules never change.” | Identity was load-only by convention, not FS-locked. |
| “Our product skills must not be rewritten.” | `pinned` / `bundled` were not enforced on the whole skill folder. |
| “Secrets never leave the sandbox into chat or memory.” | Secrets were redacted on the bash command line only. |
| “This tenant cannot enable tools we disabled.” | Tool lists could still be widened per session (P1). |
| “We need to plug in our compliance checks.” | No first-class pre/post tool policy hook (P2). |

**M1 closes** identity locks, locked skills, and secret scrubbing. **P1/P2**
cover sealed tool allowlists and host policy hooks.

## 3. Goal

Give host apps a **company envelope**: a sealed set of rules the company sets once.

Inside the envelope the agent works freely (bash, files, tools, proposals).

Outside the envelope the agent has no path: it cannot change identity, widen tools, overwrite locked company skill folders, or persist secrets.

### Success looks like

1. A host seeds SOUL, AGENTS, network allowlist, secrets list, and tool policy once.
2. End users chat with an agent that uses tools and workspace without constant friction.
3. When the agent (or curator) wants to remember something or add a skill, that change is staged for human approval by default.
4. Attempts to rewrite SOUL, AGENTS, or **locked company skills** (whole skill folder) fail in code, not in prompt text.
5. Secrets that appear in tool output are redacted before the model sees them and before memory/skills can store them.
6. The agent can still create and evolve **new** tenant skills under approval. Locked company skills stay readable and usable, never mutable by internal processes.

### Non-goals (this PRD)

- Replacing AgentFS with Postgres
- Multi-machine volume sharing (see [multi-machine](multi-machine.md))
- A hosted gateway, chat channels, or admin dashboard
- Multi-agent teams, vault/KG, media generation, or GoClaw’s full built-in tool catalog inside the kit
- Credentialed cloud-CLI product (`gh` / `aws` / `kubectl` presets) as a kit feature (hosts may add via `addTools` / sandbox later)
- Full episodic / knowledge-graph memory (possible later)

## 4. Who this is for

| Role | Need |
| ---- | ---- |
| **Company / product owner** (host app) | Define identity, allowed tools, network, secrets, and protected skills once. Trust the kit to enforce them. |
| **Tenant end user** | Chat with an agent that feels capable and personal over time. |
| **Human reviewer** (ops / admin) | Approve or reject proposed memory and skill changes. |
| **Kit maintainer** | Clear zones and APIs so enforcement lives in one place, not in every example app. |

agent-kit stays a **library**. The host app still does login, billing, and UI. The kit enforces the envelope once the host configures it.

## 5. Product model: three zones

Everything the agent can touch falls into one zone.

```text
┌─────────────────────────────────────────────────────────────┐
│  COMPANY ENVELOPE (sealed at createTenantHome)              │
│  identity • tool policy • network • secrets • locked skills │
├──────────────────────┬──────────────────┬───────────────────┤
│  IMMUTABLE           │  APPROVAL-GATED  │  FREE             │
│  SOUL.md             │  USER.md         │  /workspace       │
│  AGENTS.md           │  MEMORY.md       │  allowed bash     │
│  locked skill        │  unlocked skills │  allowed tools    │
│  folders (full tree) │  (via pending/)  │  session scratch  │
│                      │                  │                   │
│  Agent: read / use   │  Agent: propose  │  Agent: do work   │
│  Host: write only    │  Human: approve  │  Guardrails still │
│  via privileged seed │                  │  apply            │
└──────────────────────┴──────────────────┴───────────────────┘
```

**Rules of ownership**

1. **Company owns identity and envelope.** SOUL, AGENTS, tool policy, network, secrets, locked skills.
2. **Tenant adapts through memory and unlocked skills.** Only with write approval when that gate is on (default on).
3. **Session owns scratch.** Workspace files and chat turns do not rewrite company identity or locked skills.

“Feels free” means: inside FREE and APPROVAL-GATED zones the agent uses normal tools without a special locked-down persona. The walls are invisible until the agent hits them.

### Locked skills (agentskills folders)

Skills use the [agentskills.io](https://agentskills.io/specification) layout: one directory per skill, required `SKILL.md` (YAML frontmatter + body), optional support files under `scripts/`, `references/`, `assets/`, and (in this kit) `templates/`.

A **locked skill** is a company-owned skill folder that internal processes must never update.

| Who / what | May read / use | May change folder or any file inside it |
| ---------- | -------------- | ---------------------------------------- |
| Agent tools (`skill_view`, list) | Yes | No |
| Agent tools (`skill_manage` create/edit/patch/delete/write_file/remove_file) | — | No |
| Curator background review | May suggest *new* unlocked skills | No (must not stage or apply changes into a locked folder) |
| Human approve / `approvePendingWrites` replay | — | No (replay must refuse locked targets) |
| Agent-facing volume FS / bash that can reach `skills/<name>/` | Read only if reachable | No writes, renames, or deletes under that prefix |
| Host privileged seed / company deploy | Yes | Yes (only path that may install or upgrade locked skills) |

**How a skill becomes locked**

1. Host marks it at seed time (preferred): e.g. `lockedSkills: ["billing-api", "safety-runbook"]` or seed metadata `locked: true`.
2. Or frontmatter / kit metadata on install: e.g. `metadata.locked: true`, or existing `pinned` / `bundled` treated as locked for mutation.

Locking is **folder-scoped**, not “SKILL.md only.” Changing `scripts/foo.py` or deleting `references/bar.md` is the same class of violation as editing `SKILL.md`.

**What stays allowed**

- Agents may `skills_list` and `skill_view` locked skills (progressive disclosure unchanged).
- Agents may create **new** unlocked skills with different names (behind approval).
- Hosts may ship updates to locked skills only through the privileged seed/deploy path (company release), never through the chat or curator loop.

### Environment surface (what the agent can reach)

GoClaw ships a large **in-gateway** tool catalog (filesystem suite, web search/fetch, browser, media, cron, heartbeat, teams, vault, credentialed `gh`/`aws`/`kubectl`, MCP, channels). That fits a hosted agent platform.

agent-kit is a library. The default in-environment surface is small on purpose:

| Kit default (FREE zone) | Role |
| ----------------------- | ---- |
| `memory` | Adapt user/environment facts (approval-gated writes) |
| `skills_list` / `skill_view` / `skill_manage` | Use and propose skills |
| `session_search` | Search this tenant’s transcripts (when wired) |
| `bash` / `readFile` / `writeFile` | Work in `/workspace` under sandbox guardrails |

Everything else is **company-provided** through the host (`addTools`, MCP bridges the host wires, product APIs). The envelope decides what is reachable; it does not turn agent-kit into GoClaw.

**Company controls inside the FREE zone**

| Control | Meaning |
| ------- | ------- |
| Tool allowlist | Which tool names exist for this home. Session may narrow, never widen (P1). |
| Company tools | Host `addTools` registered at home (CRM lookup, billing API, …). Same seal rules. |
| Network | `allowedHosts` for bash/curl egress. Default deny when empty. |
| Secrets | Values redacted from commands and tool output (P0). |
| Bash policy | Built-in deny patterns plus host `blockedPatterns`. |
| Path visibility | Agent-facing FS and sandbox mounts expose `/workspace` (and any host-declared readable mounts). Immutable prefixes (`agent/`, locked `skills/<name>/`) are not writable; prefer they are not listed as writable workspace either. |
| Skill visibility | Locked and unlocked skills remain listable/viewable unless the host disables skill tools. |

**Borrow from GoClaw (patterns), do not import the catalog**

| GoClaw idea | What we take | What we leave |
| ----------- | ------------ | ------------- |
| Virtual FS + path deny | Deny/hide immutable prefixes from agent writers | Full multi-root virtual FS product |
| Tool capability classes (read-only vs mutating) | Useful later for parallel tools / hooks | Not required for M1 |
| Credentialed exec (no-shell, scrubbed env) | Optional host pattern via custom tools later | Not a kit built-in in this PRD |
| `web_fetch` / `web_search` | Host may add as company tools with their own allowlists | Not kit defaults |
| Browser, media, teams, channels, vault | — | Product/gateway scope |
| MCP | Host wires MCP into `addTools` if needed | No kit MCP gateway in this PRD |

**Product rule:** the agent should feel powerful because the **company gave it the right tools**, not because the kit ships thirty builtins. A SocialRobot (or any) host adds product tools inside the sealed allowlist; the kit keeps memory, skills, and sandbox primitives safe.

## 6. User journeys

### 6.1 Company ships a product agent

1. Host defines SOUL.md and AGENTS.md (brand, safety, product rules).
2. Host seeds **locked** company skills (how to use the product’s APIs), full agentskills folders.
3. Host sets: allowed tools (kit defaults + company `addTools`), `allowedHosts`, `secrets`, bash deny extras.
4. Host calls `createTenantHome` per customer with that envelope.
5. Envelope cannot be widened by a later `openSession` call.

**Done when:** two sessions for the same home cannot enable a tool the home did not allow; locked skill folders are present and read-only to the agent; company tools from home `addTools` are present.

### 6.2 End user chats and the agent works

1. User asks the agent to draft, search, or run commands in `/workspace`, or call a company tool (for example “look up my campaign”).
2. Agent uses allowed tools. Bash, file tools, and company tools feel normal.
3. Network calls outside `allowedHosts` fail. Unknown tool names do not exist on the session.
4. If output contains a configured secret, the model sees redacted text.
5. Agent cannot see or write immutable paths as if they were normal workspace files.

**Done when:** the user never needs to know about zones; blocked actions fail with a clear tool error; company tools work without the agent needing shell access to secrets.

### 6.3 Agent wants to remember something

1. Agent (or curator) proposes a USER.md or MEMORY.md change.
2. With write approval on, the change lands in `pending/`, not live memory.
3. Human approves or rejects.
4. Next session’s frozen snapshot includes only approved content.

**Done when:** mid-chat proposals never change the running system prompt; secrets never appear in approved memory.

### 6.4 Agent tries to change company identity

1. Agent (or buggy host code using the agent FS handle) tries to write `agent/SOUL.md`.
2. The kit rejects the write.
3. Identity files on disk stay unchanged.

**Done when:** rejection is a hard error from the filesystem or skill API, not a prompt instruction the model can ignore.

### 6.5 Agent or curator tries to override a locked skill

1. Company seeded `skills/billing-api/` as locked (`SKILL.md` plus `references/`, `scripts/`, …).
2. Agent calls `skill_manage` to edit, patch, write_file, remove_file, or delete that skill.
3. Curator proposes the same change into `pending/`, or approve replay tries to apply it.
4. Separately, something tries `writeFile("skills/billing-api/scripts/run.sh", …)` on the agent-facing FS.

**Done when:** every path fails with a clear “skill is locked” (or path deny) error. Disk contents of `skills/billing-api/**` are byte-identical before and after. A *new* skill name such as `billing-api-tenant-notes` can still be created under approval.

### 6.6 Company adds a compliance rule

1. Host registers a small policy hook (for example: block deletes of *unlocked* skills, or deny certain tool args). Locked skills are already denied by the kit; hooks are for extra company policy.
2. On each matching tool call, the hook may allow or block.
3. On hook failure or timeout, the kit blocks (fail closed).

**Done when:** the host can enforce one extra rule without forking agent-kit.

## 7. Requirements

Priority: **P0** must ship for the envelope to be real. **P1** completes the company control plane. **P2** is host extensibility.

### P0 — Enforce zones

| ID | Requirement | Acceptance criteria |
| -- | ----------- | ------------------- |
| P0.1 | Writes under `agent/` (SOUL, AGENTS, and other identity files) are denied on the agent-facing filesystem. | Spec: `writeFile("agent/SOUL.md")` via runtime FS throws or returns a deny error. File content unchanged. |
| P0.2 | Host can seed identity with a privileged writer the agent never receives. | Example-app / host seed still writes SOUL and AGENTS. Agent session FS cannot. |
| P0.3 | Host can mark a skill **locked**. Lock applies to the whole agentskills folder: `SKILL.md` and all support files (`scripts/`, `references/`, `assets/`, `templates/`, and any other files under `skills/<name>/`). | Spec: edit, patch, delete, write_file, and remove_file on a locked skill all fail. Writing `skills/<name>/references/x.md` via agent FS fails. Unlocked skills still work with approval. |
| P0.4 | Locking is enforced in code for every internal updater: agent `skill_manage`, curator proposals, `approvePendingWrites` replay, and agent-facing FS writes under that prefix. Prompt text is not the control. | Spec: curator cannot stage a successful apply into a locked folder; approve replay refuses locked targets; raw `writeFile` on agent FS is denied. |
| P0.5 | Lock mark comes from host seed list and/or install metadata (`locked` / `pinned` / `bundled`). Agents cannot clear the lock by editing frontmatter. | Spec: patching frontmatter to remove `locked` fails because the skill is already locked; host privileged path can install or replace locked skills. |
| P0.6 | Agents may still list and view locked skills (agentskills progressive disclosure). They may create **new** unlocked skills under other names. | Spec: `skills_list` / `skill_view` succeed on locked skills; `skill_manage` create with a new name still stages under approval. |
| P0.7 | Memory and unlocked skill writes still go through the existing write-approval gate by default. | Default `defineAgent` keeps approval on. Staging and approve replay still work for unlocked targets. |
| P0.8 | Docs describe the three zones and locked skills in plain language. | [security.md](../guides/security.md) and [skills-and-learning.md](../guides/skills-and-learning.md) cover locked folders. Root RULES memory paths match `memories/`. |

### P0 — Secrets do not become knowledge

| ID | Requirement | Acceptance criteria |
| -- | ----------- | ------------------- |
| P0.9 | Configured `secrets` (and agreed static credential patterns) are redacted from bash stdout/stderr before the model sees them. | Spec: command that prints a known secret returns redacted output to the tool result. |
| P0.10 | Sandbox `readFile` results are redacted the same way when they contain configured secrets. | Spec: reading a file that contains a secret returns redacted content to the model. |
| P0.11 | Memory and skill write paths scrub secrets before threat scan and before durable store. | Spec: approving a pending write that contains a secret does not persist the raw secret in USER.md / MEMORY.md / SKILL.md. |

### P1 — Seal the home

| ID | Requirement | Acceptance criteria |
| -- | ----------- | ------------------- |
| P1.1 | `createTenantHome` is the company control plane for tool policy. Session open may narrow tools, never widen them. | Spec: home without bash; session `addTools` / compose cannot add bash. |
| P1.2 | Sandbox guardrails set on the home (`allowedHosts`, `blockedPatterns`, `secrets`) cannot be loosened by a later session option. | Spec: session attempt to pass a wider allowlist is ignored or rejected. |
| P1.3 | `sandboxEnabled` (or equivalent) is consistent between `defineAgent` and home wiring. Dead config is removed or wired. | No unused flag in public API without behavior. |
| P1.4 | Host can seed a company skill pack as locked (full agentskills directories). | Seeded locked skills show in `skills_list`, load via `skill_view`, and reject all mutation paths in P0.3–P0.5. |
| P1.5 | Host can register company tools at home (`addTools`). Those tools are part of the sealed allowlist. | Spec: home-registered `crm_lookup` is available on every session; session cannot add a different unbound tool name outside the allowlist. |
| P1.6 | Agent-facing path visibility: writable work stays under `/workspace` (and host-declared writable roots). Writes to `agent/**` and locked `skills/<name>/**` fail. | Spec: sandbox `writeFile` / bash redirect into locked prefixes fail; `readFile` of locked skill files may still succeed if the company wants skills readable via FS (default: readable via `skill_view` only is enough). |
| P1.7 | Hosting guide has a “Company envelope” checklist: identity, locked skills, tool allowlist, company tools, network, secrets, path rules. | [hosting.md](../guides/hosting.md) lists seed + seal steps. |

### P2 — Host policy hooks

| ID | Requirement | Acceptance criteria |
| -- | ----------- | ------------------- |
| P2.1 | Host can register pre-tool (and post-tool) handlers on the session or home. | Public API documented; example in docs or example-app. |
| P2.2 | Pre-tool handler may allow or block. Block prevents execution. | Spec: blocked tool does not run; model receives a clear error payload. |
| P2.3 | Handler error or missing decision on a blocking event fails closed (block). | Spec: throwing handler blocks the tool. |
| P2.4 | Hooks stay in-process. No HTTP hook runner, circuit breaker, or LLM-evaluator hooks in this PRD. | Scope stays thin. |

## 8. What “feels free” means (UX contract)

The agent should not be prompted as “you are locked down.”

Instead:

- Default tools and **company tools** for the product stay available (as the company chose).
- Workspace work is normal.
- Learning is normal: the agent calls memory/skill tools as today.
- When a wall is hit, the tool returns a short, specific error (“path is immutable”, “skill is locked”, “host not allowed”, “tool not available”).
- Locked company skills still appear in the skill index and work when viewed; only mutation is blocked.
- Humans see pending proposals for **unlocked** learning in the same approve flow they already have.

Do not solve safety only by stuffing more “MUST NOT” text into SOUL.md. Soft instructions are extra. Hard controls are the product.

## 9. API / surface sketch (for implementers)

Exact names can change in implementation. Behavior must not.

```ts
// Company envelope at home creation
const home = await createTenantHome({
  tenantId,
  definition, // includes SOUL/AGENTS via volume seed
  tools: {
    allow: [
      "memory",
      "skills_list",
      "skill_view",
      "skill_manage",
      "session_search",
      "bash",
      "readFile",
      "writeFile",
      "crm_lookup", // company tool names must be listed
    ],
    addTools: [crmLookup], // sealed at home; sessions cannot add tools outside allow
  },
  sandbox: {
    allowedHosts: ["api.company.com"],
    secrets: [process.env.TENANT_API_KEY!],
    blockedPatterns: [/.../],
  },
});

// Privileged seed (host only). lockedSkills are full agentskills folders.
await seedCompanyFiles(privilegedFs, {
  soul,
  agentsMd,
  lockedSkills: [
    {
      name: "billing-api",
      files: {
        "SKILL.md": "---\nname: billing-api\ndescription: ...\n---\n...",
        "references/api.md": "...",
        "scripts/check.sh": "...",
      },
    },
  ],
});

// Optional P2
const session = await home.openSession(sessionId, {
  onBeforeTool: async ({ name, args }) =>
    name === "skill_manage" && args.action === "delete"
      ? { decision: "block", reason: "deletes require admin" }
      : { decision: "allow" },
});
```

Agent-facing FS used by the runtime must be the policy-wrapped FS, not the raw volume. Path policy must deny writes under `skills/<locked-name>/**` as well as `agent/**`.

## 10. Risks and open decisions (resolved for this PRD)

| Topic | Decision |
| ----- | -------- |
| May tenants customize SOUL? | No for this PRD. SOUL and AGENTS are company-immutable. Per-user personality lives in USER.md. |
| May agents override company skills? | No. Locked skill folders are immutable to agent, curator, approve replay, and agent-facing FS. Host privileged seed is the only writer. |
| Is lock only on `SKILL.md`? | No. Lock is the whole agentskills directory tree for that skill name. |
| May the agent add a parallel skill? | Yes. A new unlocked skill with a different name may capture tenant-specific notes (behind approval). It must not replace or shadow a locked name. |
| Do we copy GoClaw’s built-in tools? | No. Kit keeps a small default surface. Companies add product tools via sealed home `addTools`. Web/browser/media/teams stay out of kit scope for this PRD. |
| What can the agent reach on disk? | Writable: `/workspace` (and host-declared writable roots). Immutable: `agent/**`, locked `skills/<name>/**`. Readable skill content via `skill_view` (and optionally FS read if exposed). |
| May the company turn approval off? | Yes, host may set `writeApproval` false. Default remains on. Envelope path locks and skill locks still apply. |
| Are workspace files approval-gated? | No. Workspace is FREE. Learning into memory/unlocked skills is gated. |
| Does bash under `/workspace` rewrite `agent/` or locked skills? | No. Path policy and mount layout must keep those prefixes out of the writable view, or deny writes if reachable. |
| Postgres for agent state? | Out of scope. Agent state stays on the tenant AgentFS volume. |

## 11. Rollout

| Milestone | Delivers | Exit criteria |
| --------- | -------- | ------------- |
| M1 | P0 zones + secret scrubbing | All P0 acceptance tests green; security guide updated |
| M2 | P1 sealed home + company tools + path visibility + hosting checklist | Home cannot be widened; example-app uses envelope with at least one company tool |
| M3 | P2 thin hooks | One documented host policy example; fail-closed specs green |

Verification gate for each milestone: `npx nx run-many -t typecheck test build --all`.

## 12. How we will know it worked

- A reviewer can point to code paths that deny identity writes and locked skill folder mutations (not prompt text).
- A demo shows: free workspace use → company tool call → use a locked company skill → staged memory / new unlocked skill proposal → secret in tool output redacted → SOUL write and locked-skill edit both fail.
- Hosting docs let a new integrator set an envelope and mark locked skills without reading core source.
- No regression: existing offline tests and InMemoryFs flows still pass with the policy wrapper.

## 13. References

- Current security behavior: [guides/security.md](../guides/security.md)
- Hosting: [guides/hosting.md](../guides/hosting.md)
- Learning loop: [guides/skills-and-learning.md](../guides/skills-and-learning.md)
- Sandbox: [guides/sandbox.md](../guides/sandbox.md)
- Skill format: [agentskills.io specification](https://agentskills.io/specification)
- Inspiration (patterns only): GoClaw mutability locks, output scrubbing, fail-closed policy hooks
