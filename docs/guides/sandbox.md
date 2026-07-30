# Sandbox

The sandbox gives the agent a workspace and a shell that cannot freely destroy
the host or leak secrets. The agent gets `bash`, `readFile`, and `writeFile`
tools. Commands run in [just-bash](https://github.com/vercel-labs/just-bash)
behind kit guardrails, not on your real machine shell.

## Happy path (`createTenantHome`)

Use this unless you are building a custom host without `createTenantHome`.
The home opens the tenant volume and wires sandbox tools into every session.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId, // from your auth layer
  agent,
  workspaceFiles: { "README.md": "# workspace\n" },
  sandbox: {
    // Hostnames only (not full URLs)
    allowedHosts: ["api.example.com"],
    secrets: [process.env.TENANT_API_KEY!],
  },
});

const session = await home.openSession(sessionId);
// session already has bash / readFile / writeFile
```

| Option | Meaning |
| ------ | ------- |
| `sandbox: true` or omit | Sandbox on (default). Workspace persists on the tenant volume under `/workspace`. |
| `sandbox: { … }` | Same, with guardrail options (`allowedHosts`, `secrets`, …). |
| `sandbox: false` | No shell tools. |
| `workspaceFiles` | Seed files written into `/workspace` when the home is created. |

You do **not** call `openTenantVolume` or `createTenantBashToolkit` in this path.
`home.bash` is available if you need the toolkit handle yourself.

## What the sandbox is

| Piece | Role |
| ----- | ---- |
| Tenant volume | One SQLite file per tenant. Holds memory, skills, and `/workspace` files. |
| just-bash | In-process Unix-like shell (not the host shell). |
| Guardrails | Block destructive commands, secret dumps, and non-allowlisted network. |
| bash-tool | Exposes `bash`, `readFile`, `writeFile` to the model. |

## What is blocked before run

| Category | Examples |
| -------- | -------- |
| Destructive | `rm -rf /`, fork bombs, writing block devices, shutdown |
| Credential theft | `curl … $SECRET`, `cat .env`, reading SSH private keys |
| Bad network | Host not listed in `allowedHosts` |

Blocked commands return an error string to the model. They do not execute.

Each command, file read, and file write is audited (tenant id, command or path,
exit code, snapshot id when available).

## Advanced: build the toolkit yourself

Only if you are **not** using `createTenantHome` and you open sessions with
`openAgentSession` by hand.

```ts
import { openTenantVolume, createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";

const volume = await openTenantVolume(`/data/tenants/${tenantId}.db`);
const bash = await createTenantBashToolkit({
  tenantId,
  volume, // omit for an in-memory workspace that dies with the process
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
  allowedHosts: ["api.example.com"],
  secrets: ["MY_API_KEY"],
});

const session = await openAgentSession({
  tenantId,
  fs: /* your agent FS */,
  definition,
  sandboxTools: bash.tools,
});
```

Prefer the happy path above for product hosts.

## Next

- Threat model: [Security](security.md)
- Auth + volume + session: [Hosting](hosting.md)
