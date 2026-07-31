# Sandbox

The agent gets `bash`, `readFile`, and `writeFile` in an isolated
[just-bash](https://github.com/vercel-labs/just-bash) workspace. That is not
your host shell. Kit guardrails block destructive commands, secret dumps, and
hosts you did not allow.

Command list (optional `curl`, `js-exec`, `python3`, …):
[just-bash supported commands](https://github.com/vercel-labs/just-bash/tree/main/packages/just-bash#supported-commands).

## Happy path

`createTenantHome` opens the tenant volume and wires sandbox tools into every
session. You do not call `createTenantBashToolkit` yourself.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { defineCommand } from "@socialrobot-io/agent-kit-sandbox";
import { agent } from "./generated/agent";

const hello = defineCommand("hello", async (args) => ({
  stdout: `Hello, ${args[0] || "world"}!\n`,
  stderr: "",
  exitCode: 0,
}));

const home = await createTenantHome({
  tenantId, // from your auth layer
  agent,
  workspaceFiles: { "README.md": "# workspace\n" },
  sandbox: {
    allowedHosts: ["api.example.com"], // hostnames only; enables curl (GET/HEAD)
    secrets: [process.env.TENANT_API_KEY!],
    javascript: true, // js-exec (QuickJS). Or python: true for python3
    customCommands: [hello], // optional host-defined bash commands
  },
});

const session = await home.openSession(sessionId);
```

| Option | Meaning |
| ------ | ------- |
| `sandbox: true` or omit | Sandbox on (default). `/workspace` persists on the tenant volume. |
| `sandbox: false` | No shell tools. |
| `allowedHosts` | Hostnames only. Registers `curl` for those hosts (GET/HEAD). Off = no `curl`. |
| `secrets` | Redacted from dumps / tool output. Do not put secrets in prompts. |
| `javascript` | `true` or `{ bootstrap }` → `js-exec`. Node only. Off by default. |
| `python` | `true` → `python3` / `python`. Node only. Off by default. |
| `customCommands` | Host commands from `defineCommand`. Runs in your process; treat as trusted. |
| `workspaceFiles` | Seed files under `/workspace` when the home is created. |

With runtimes on, the agent can run for example:

```bash
js-exec -c "console.log(1 + 2)"
python3 -c "print(1 + 2)"
curl -s https://api.example.com/health
hello Alice
```

Demo: [`examples/example-app`](../../examples/example-app) at `/code-runner` (`javascript: true`).

For product APIs (CRM, billing), prefer a host `SessionTool` via `addTools`
([Tools](tools.md)), not a custom bash command.

## What is blocked

| Category | Examples |
| -------- | -------- |
| Destructive | `rm -rf /`, fork bombs, writing block devices |
| Credential theft | `curl … $SECRET`, `cat .env`, reading SSH keys |
| Bad network | Host not in `allowedHosts` |

Blocked commands return an error to the model; they do not run. Bash, reads,
and writes are audited per tenant.

## Next

- Host tools vs sandbox vs skills: [Tools](tools.md)
- Threat model: [Security](security.md)
- Auth + volume + session: [Hosting](hosting.md)
