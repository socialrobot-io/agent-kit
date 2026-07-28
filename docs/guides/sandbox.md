# Sandbox

A safe body for the agent — isolated storage and a guarded shell.

## Why it exists

An agent with raw shell access is a liability. It can delete files, dump
credentials, or call arbitrary hosts. In a multi-tenant product, one bad
command can become someone else's breach.

agent-kit does not hand the agent your host. It hands the agent a
**per-tenant [AgentFS](https://www.agentfs.ai/) volume** for durable home
state, and runs tool commands inside
[just-bash](https://github.com/vercel-labs/just-bash) via
[bash-tool](https://github.com/vercel-labs/bash-tool) with guardrails.

## How just-bash is wired

We follow the official bash-tool pattern: construct a `Bash` instance, then
pass it (through our tenant wrapper) to `createBashTool({ sandbox })`.

```ts
import { Bash } from "just-bash";
import { createBashTool } from "bash-tool";

const bash = new Bash({
  cwd: "/workspace",
  files: { "/workspace/README.md": "…" },
  executionLimitProfile: "hardened",
  network: undefined, // curl off until you set allowedUrlPrefixes
  defenseInDepth: { enabled: "auto" }, // false under Next.js
});

const { tools } = await createBashTool({
  sandbox: bash,
  destination: "/workspace",
  onBeforeBashCall: …, // agent-kit guardrails
});
```

`createTenantBashToolkit` does that for you and adds:

| Layer | Role |
| ----- | ---- |
| just-bash `Bash` | In-memory FS, Unix utilities, optional network allowlist, hardened execution limits |
| `TenantAgentFSSandbox` | Per-tenant audit + command guardrails on every `executeCommand` / read / write |
| bash-tool | AI SDK `bash` / `readFile` / `writeFile` tools + `onBeforeBashCall` |

Defense-in-depth is **off under Next.js** because Next patches `Date.now` /
`process.env` and just-bash's DID proxies recurse with those patches. Outside
Next it uses `{ enabled: "auto" }` as recommended by just-bash.

Python and `js-exec` stay off unless you opt in — they add security surface.

## What is isolated

Each tenant gets:

- Its own filesystem (skills, memory, pending writes, workspace files)
- Its own command audit trail
- Its own snapshots (rollback-ready)

Tenant A's files and commands never share storage with tenant B.

## Guardrails (before execution)

Every bash command is evaluated first:

| Blocked | Examples |
| ------- | -------- |
| Destructive | `rm -rf /`, fork bombs, writing block devices, shutdown |
| Credential exfil | `curl … $SECRET`, `cat .env`, SSH private key paths |
| Bad egress | Any URL whose host is not on your allowlist |

Configured secrets are **redacted** from the command line before it runs or is
logged. A blocked command returns a clear error to the agent instead of
running.

When you pass `allowedHosts`, just-bash also gets a matching
`network.allowedUrlPrefixes` so `curl` only exists for those origins.

## Audit trail

Every command, file read, and file write is recorded with:

- the tenant
- the command or path
- files touched (best-effort)
- exit code
- the post-action snapshot id

That is what you show in a compliance UI — and what you use to roll a volume
back.

## Fit with the rest of the stack

The sandbox is one wall of the [security model](security.md). Content is
scanned before it reaches the prompt. Learning is gated by human approval.
Actions are sandboxed. Tenants are isolated.

Together: agents you can put behind a paying customer.
