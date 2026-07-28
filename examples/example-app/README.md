# Example app

Live, end-to-end demo of agent-kit's self-improvement loop: a real model, a
persistent AgentFS agent home, memory + skill learning behind human approval,
recall in a later session, and an interactive chat REPL.

See the [root README](../../README.md) and [Models & the loop](../../docs/guides/models.md)
for the broader toolkit.

## What it shows

1. **Session 1** - `runAgentTurn` with a live model; the agent can call Hermes
   tools (`memory`, skills, ...).
2. **Curator** - `runBackgroundReview` (combined) stages durable writes.
3. **Approve** - replay pending memory + skill writes into the volume.
4. **Session 2** - a fresh `AgentSessionRuntime` on the same volume sees the
   frozen snapshot with approved facts.
5. **Chat** - readline REPL that keeps talking against the same volume.

## Setup

```bash
cd examples/example-app
cp .env.sample .env
# Add AI_GATEWAY_API_KEY from https://vercel.com/ai-gateway (or a self-hosted gateway)
# Optionally change MODEL
```

Default model is `deepseek/deepseek-v4-flash` via the Vercel AI Gateway. Any
`"provider/model"` gateway id works.

## Commands

```bash
bun run start   # scripted live demo (needs AI_GATEWAY_API_KEY)
bun run chat    # interactive REPL (needs AI_GATEWAY_API_KEY)
bun run test    # offline vitest smoke test (no key, no network)
```

The AgentFS volume lives at `.agentfs/example.db` under this package. Re-running
`start` or `chat` keeps learned memory and skills (seed files are only written
when absent).
