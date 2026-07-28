# Sandbox

Per-tenant [AgentFS](https://www.agentfs.ai/) volume +
[just-bash](https://github.com/vercel-labs/just-bash) via
[bash-tool](https://github.com/vercel-labs/bash-tool).

## Create the toolkit

```ts
import { openAgentFs, createTenantBashToolkit } from "@agent-kit/sandbox";

const tenantId = "brand-123";
const afs = await openAgentFs(`/data/tenants/${tenantId}.db`);

const bash = await createTenantBashToolkit({
  tenantId,
  agentFs: afs, // same .db as memory; workspace under /workspace
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
  allowedHosts: ["https://api.example.com"], // optional; enables curl for these
  secrets: ["MY_API_KEY"],                   // redacted from cmdline + logs
});

// bash.tools → AI SDK ToolSet: bash, readFile, writeFile
```

Without `agentFs`, workspace is in-memory and does not land in AgentFS:

```ts
const ephemeral = await createTenantBashToolkit({
  tenantId: "brand-123",
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
});
```

| Layer | Role |
| ----- | ---- |
| AgentFS | Durable home: `memories/`, `skills/`, `/workspace/*` |
| just-bash | Unix layout; `/workspace` on AgentFS when persisted |
| `TenantAgentFSSandbox` | Guardrails + audit on execute/read/write |
| bash-tool | AI SDK tools + `onBeforeBashCall` |

Defense-in-depth is off under Next.js (Next patches `Date.now` / `process.env`).
Elsewhere: `{ enabled: "auto" }`. Python and `js-exec` stay off unless you opt in.

## Guardrails (before run)

| Blocked | Examples |
| ------- | -------- |
| Destructive | `rm -rf /`, fork bombs, block devices, shutdown |
| Credential exfil | `curl … $SECRET`, `cat .env`, SSH private keys |
| Bad egress | Host not on `allowedHosts` |

Blocked commands return an error to the agent. They do not run.

## Audit record

Each command / file read / write logs: tenant, command or path, files touched
(best-effort), exit code, post-action snapshot id.
