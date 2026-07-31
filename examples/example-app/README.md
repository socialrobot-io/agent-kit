# Example app (Next.js)

Streaming chat over agent-kit via AI SDK UI (`useChat` and UI message stream).
Two demos share the same Next app:

| Route | Agent | Volume | Sandbox |
| ----- | ----- | ------ | ------- |
| `/` | `agent/` | `.agentfs/example.db` | bash / readFile / writeFile |
| `/code-runner` | `agents/code-runner/` | `.agentfs/code-runner.db` | same + `js-exec` (`javascript: true`) |

## Setup

```bash
cd examples/example-app
cp .env.sample .env.local
# Preferred: set DEEPSEEK_API_KEY from https://platform.deepseek.com
# Fallback: set AI_GATEWAY_API_KEY from https://vercel.com/ai-gateway
```

Default model is `deepseek-v4-flash` via [`@ai-sdk/deepseek`](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek).

## Run

```bash
npx nx dev example
```

- Chat: http://localhost:3000
- Code runner: http://localhost:3000/code-runner

## Layout

- `agent/` — main chat SOUL / AGENTS / skills
- `agents/code-runner/` — js-exec-focused SOUL / AGENTS
- `src/lib/agent.ts` — main `createTenantHome` + sessions
- `src/lib/code-runner-agent.ts` — second home with `sandbox: { javascript: true }`
- `src/app/api/chat` · `src/app/api/code-runner/chat` — stream routes
- `src/app/chat-shell.tsx` — shared chat UI

## Deploy: compile agents into the bundle

```bash
npx nx run example:compile-agent
# → src/generated/agent.ts
# → src/generated/code-runner-agent.ts
```

`dev` / `build` already depend on `compile-agent`. After editing either agent
tree, re-run compile (or restart `nx dev`).
