# Example app (Next.js)

Streaming chat over agent-kit via AI SDK UI (`useChat` and UI message stream).
Persistent AgentFS memory and skills, live DeepSeek by default, and bash-tool
sandbox tools (`bash`, `readFile`, `writeFile`) behind agent-kit guardrails.

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

Open http://localhost:3000. Messages stream token-by-token. Memory, skill, and
bash tool calls appear as they run.

- Agent home volume: `.agentfs/example.db`
- Bash workspace: isolated just-bash FS seeded with `/workspace/README.md`

## Layout

- `agent/` — SOUL.md, AGENTS.md, `skills/` (seeded via `createTenantHome({ company })`)
- `agent/skills/bullet-briefing/` — agent-folder skill marked `locked: true`
- `src/lib/agent.ts` — `createTenantHome` + per-chat `openSession`
- `src/app/api/chat/route.ts` — `session.stream` with built-in and bash tools
- `src/app/page.tsx` — `@ai-sdk/react` `useChat` UI

## Deploy: compile `agent/` into the bundle

Author skills under `agent/`. Before build/dev, compile them into an importable
module (works on Next, Docker, workers, plain Node):

```bash
npx nx run example:compile-agent
# → src/generated/agent.ts
```

`createTenantHome({ agent })` imports that module, so bundlers ship the content
without a runtime `agent/` directory.

`dev` / `build` already depend on `compile-agent`. After editing `agent/`,
re-run compile (or restart `nx dev`). Optional: `seedAgentHome` on new chats
still re-reads disk for local HMR.