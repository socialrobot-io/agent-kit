# code-runner example

Minimal Bun script that opens a tenant home with **sandboxed JavaScript**
(`js-exec` via [just-bash](https://github.com/vercel-labs/just-bash)) and runs
one agent turn. Also shows a host `SessionTool` (`server_time`) via `addTools`.

## What it shows

| Piece | How |
| ----- | --- |
| Sandbox JS | `createTenantHome({ sandbox: { javascript: true } })` |
| Host tool | `openSession({ addTools: [serverTime] })` |
| Agent files | `agent/SOUL.md` + `AGENTS.md` compiled with `compileAgent` |

Python is the same toggle: set `sandbox: { python: true }` for `python3`.

## Setup

From the repo root:

```bash
bun install
cd examples/code-runner
cp .env.sample .env   # set AI_GATEWAY_API_KEY
bun scripts/compile-agent.ts
bun src/main.ts
# or: npx nx start code-runner
```

## Offline test (no API key)

```bash
npx nx test code-runner
```

The smoke test mocks the model and asserts a real `js-exec` call inside the
sandbox.

## Related docs

- [Sandbox](../../docs/guides/sandbox.md): curl, JS/Python, `defineCommand`
- [Tools](../../docs/guides/tools.md): host tools vs sandbox vs skills
