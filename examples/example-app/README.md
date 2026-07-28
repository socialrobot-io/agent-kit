# Example app (Next.js)

Streaming chat over agent-kit via AI SDK UI (`useChat` + UI message stream).
Persistent AgentFS memory/skills, live DeepSeek by default, and bash-tool
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

Open http://localhost:3000. Messages stream token-by-token; memory / skill /
bash tool calls appear as they run.

- Agent home volume: `.agentfs/example.db`
- Bash workspace: isolated just-bash FS seeded with `/workspace/README.md`

## Layout

- `agent/` - SOUL.md, AGENTS.md, seed skill
- `src/lib/agent.ts` - runtime + `createTenantBashToolkit`
- `src/app/api/chat/route.ts` - `streamAgentTurn` with Hermes + bash tools
- `src/app/page.tsx` - `@ai-sdk/react` `useChat` UI
