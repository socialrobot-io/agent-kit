# Sandbox

The sandbox gives the agent a workspace and a shell that cannot freely destroy
the host or leak secrets.

It combines:

- a per-tenant [AgentFS](https://www.agentfs.ai/) volume (durable files), and
- [bash-tool](https://github.com/vercel-labs/bash-tool) /
  [just-bash](https://github.com/vercel-labs/just-bash) (the shell the model calls).

## Create the toolkit

Pass the same AgentFS handle you use for memory so workspace files persist on
that tenant’s volume under `/workspace`.

```ts
import { openAgentFs, createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";

const tenantId = "brand-123";
const afs = await openAgentFs(`/data/tenants/${tenantId}.db`);

const bash = await createTenantBashToolkit({
  tenantId,
  agentFs: afs,
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
  // optional: allow curl only to these hosts
  allowedHosts: ["https://api.example.com"],
  // optional: redact these names from command lines and logs
  secrets: ["MY_API_KEY"],
});

// bash.tools is an AI SDK ToolSet: bash, readFile, writeFile
```

Pass `bash.tools` into `openAgentSession` as `sandboxTools`. See
[Hosting](hosting.md).

### Ephemeral workspace (no AgentFS)

If you omit `agentFs`, the workspace stays in memory and is discarded when the
process ends.

```ts
const ephemeral = await createTenantBashToolkit({
  tenantId: "brand-123",
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
});
```

## How the pieces fit

| Piece | Role |
| ----- | ---- |
| AgentFS | Durable home for `memories/`, `skills/`, and `/workspace/*` |
| just-bash | Unix-like shell layout |
| Kit sandbox layer | Checks commands before they run; writes audit records |
| bash-tool | Exposes `bash`, `readFile`, and `writeFile` to the model |

Extra host hardening (“defense in depth”) stays off under Next.js, because
Next patches `Date.now` and `process.env`. Elsewhere you can use
`{ enabled: "auto" }`. Python and `js-exec` stay off unless you turn them on.

## What is blocked before run

| Category | Examples |
| -------- | -------- |
| Destructive | `rm -rf /`, fork bombs, writing block devices, shutdown |
| Credential theft | `curl … $SECRET`, `cat .env`, reading SSH private keys |
| Bad network | Host not listed in `allowedHosts` |

Blocked commands return an error string to the model. They do not execute.

## Audit record

Each command, file read, and file write logs:

- tenant id
- command or path
- files touched (best effort)
- exit code
- snapshot id after the action

## Next

- Threat model across the whole kit: [Security](security.md)
- Wire sandbox tools into a session: [Hosting](hosting.md)
