# Example app (Next.js)

Streaming chat over agent-kit via AI SDK UI (`useChat` and UI message stream).
Two demos share the same Next app; each has its own folder under `agents/`:

| Route | Agent | Volume | Sandbox |
| ----- | ----- | ------ | ------- |
| `/` | `agents/chat/` | `.agentfs/example.db` | bash / readFile / writeFile |
| `/code-runner` | `agents/code-runner/` | `.agentfs/code-runner.db` | same + `js-exec` (`javascript: true`) |

## Setup

```bash
cd examples/example-app
cp .env.sample .env.local
# First: set DEEPSEEK_API_KEY (AI SDK provider @ai-sdk/deepseek)
# https://platform.deepseek.com
# Second: set AI_GATEWAY_API_KEY (Vercel AI Gateway)
# https://vercel.com/ai-gateway
```

Default model is `deepseek-v4-flash` via
[`@ai-sdk/deepseek`](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek).
Gateway is used only when `DEEPSEEK_API_KEY` is unset.

## Run

```bash
npx nx dev example
```

- Chat: http://localhost:3000
- Code runner: http://localhost:3000/code-runner

## Layout

- `agents/chat/` — main chat SOUL / AGENTS / skills
- `agents/code-runner/` — js-exec-focused SOUL / AGENTS
- `src/lib/kit.ts` — `createAgentKit` for the chat demo (stateless by default)
- `src/lib/code-runner-kit.ts` — second kit with `sandbox: { javascript: true }`
- `src/app/api/chat` · `src/app/api/code-runner/chat` — stream routes
- `src/app/chat-shell.tsx` — shared chat UI

Both demos use the same `createAgentKit` happy path from the root
[README](../../README.md#set-up). The kit is **stateless by default**: each
request opens a fresh session from disk (volume + transcripts persist; the
live handle is not retained). Set `maxSessions` to opt into a per-chat LRU
cache for the perf win.

## Deploy: compile agents into the bundle

```bash
npx nx run example:compile-agent
# → src/generated/agent.ts          (from agents/chat)
# → src/generated/code-runner-agent.ts
```

`dev` / `build` already depend on `compile-agent`. After editing either agent
tree, re-run compile (or restart `nx dev`).
