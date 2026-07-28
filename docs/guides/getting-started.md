# Getting started

```bash
git clone git@github.com:ntgussoni/agent-kit.git
cd agent-kit
bun install
bun packages/cli/src/lib/demo.ts   # offline; no API keys
```

Demo covers: session → curator stages memory/skill → approve → recall → tenant B sees nothing.

## Author an agent

```text
agent/
  SOUL.md       identity (always in the system prompt)
  AGENTS.md     house rules
  skills/       reusable procedures
  memories/     MEMORY.md + USER.md (agent-written)
```

```md
<!-- SOUL.md -->
You are a concise research assistant for a fintech startup.
```

```md
<!-- AGENTS.md -->
Prefer short, factual answers. Cite a source for every non-obvious claim.
Never invent numbers.
```

Custom tools: [Tools](tools.md).

## Run a turn

Needs `AI_GATEWAY_API_KEY` (or your own `LanguageModel`). Uses `InMemoryFs` so
you can try without opening a SQLite volume. Production: [Hosting](hosting.md).

```ts
import { AgentSessionRuntime, defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { runAgentTurn } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are a concise research assistant.");
await fs.writeFile("agent/AGENTS.md", "Prefer short, factual answers.");

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",
  fs,
  definition,
});
await runtime.init();

const turn = await runAgentTurn(
  [{ role: "user", content: "Help me plan a product launch." }],
  { runtime, definition },
);
console.log(turn.text);
```

After the session: curator proposes → `pending/` → human approve → next session
snapshot. Details: [Models](models.md), [Hosting](hosting.md), [Security](security.md).
