# Sandbox

The sandbox gives the agent a workspace and a shell that cannot freely destroy
the host or leak secrets. The agent gets `bash`, `readFile`, and `writeFile`
tools. Commands run in [just-bash](https://github.com/vercel-labs/just-bash)
behind kit guardrails, not on your real machine shell.

Supported Unix utilities and optional runtimes are listed upstream:
[just-bash supported commands](https://github.com/vercel-labs/just-bash/tree/main/packages/just-bash#supported-commands).

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
| `sandbox: { … }` | Same, with guardrails and optional runtimes (`allowedHosts`, `javascript`, `python`, …). |
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

## Curl / network

Network is **off** by default. When you set `allowedHosts`, just-bash registers
`curl` for those hostnames only, and agent-kit still blocks non-allowlisted
hosts in the command string.

```ts
const home = await createTenantHome({
  tenantId,
  agent,
  sandbox: {
    allowedHosts: ["api.example.com"], // hostname only, not https://…
    secrets: [process.env.TENANT_API_KEY!],
  },
});
```

| Detail | Behavior today |
| ------ | -------------- |
| Methods | `GET` and `HEAD` only |
| Matching | Hostname → `http://` and `https://` prefixes |
| Without `allowedHosts` | `curl` is not registered (`command not found`) |

Do not put secrets in prompts. Pass them as `secrets` so guardrails redact
dumps; inject tokens from your host tools when the agent needs authenticated
calls.

## JavaScript and Python

just-bash optional runtimes are **off** until you enable them (extra security
surface; Node only, not browsers).

```ts
const home = await createTenantHome({
  tenantId,
  agent,
  sandbox: {
    javascript: true, // js-exec (QuickJS)
    // python: true, // python3 / python (CPython WASM)
  },
  workspaceFiles: {
    "README.md": "Use js-exec for calculations. Write scripts under /workspace.\n",
  },
});
```

Examples the agent can run after enablement:

```bash
js-exec -c "console.log(1 + 2)"
js-exec script.js
python3 -c "print(1 + 2)"
python3 script.py
```

You can pass bootstrap code for every `js-exec` call:

```ts
sandbox: {
  javascript: { bootstrap: "globalThis.API_BASE = 'https://api.example.com';" },
}
```

Runnable demo: [`examples/code-runner`](../../examples/code-runner).

## Custom bash commands

Extend the shell with TypeScript commands via `defineCommand` (re-exported from
`@socialrobot-io/agent-kit-sandbox`).

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { defineCommand } from "@socialrobot-io/agent-kit-sandbox";

const hello = defineCommand("hello", async (args) => ({
  stdout: `Hello, ${args[0] || "world"}!\n`,
  stderr: "",
  exitCode: 0,
}));

const home = await createTenantHome({
  tenantId,
  agent,
  sandbox: { customCommands: [hello] },
});
// Agent can: bash → hello Alice
```

Custom commands run in the host process. Treat them like trusted host tools:
never `eval` guest-provided code inside them. For product APIs, prefer a
`SessionTool` via `addTools` instead ([Tools](tools.md)).

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
  javascript: true,
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

- Host tools vs sandbox vs skills: [Tools](tools.md)
- Threat model: [Security](security.md)
- Auth + volume + session: [Hosting](hosting.md)
