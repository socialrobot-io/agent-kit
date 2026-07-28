# Getting started

Ship a production-grade agent in a few minutes.

## Install

```bash
git clone git@github.com:ntgussoni/agent-kit.git
cd agent-kit
bun install
```

No API keys required for the demo or the tests — everything runs offline with
in-memory adapters.

## Watch the production loop

```bash
bun packages/cli/src/lib/demo.ts
```

You'll see the full story: a session, a curated memory + skill staged for
approval, a human approve step, recall in a second session, and a second tenant
that sees none of it.

## Author an agent

An agent is a directory:

```text
agent/
  SOUL.md       who the agent is
  AGENTS.md     house rules and persistent context
  skills/       reusable procedures
  memories/     curated MEMORY.md + USER.md (written by the agent)
  tools/        host-registered actions
```

**SOUL.md** — identity. Always in the system prompt.

```md
You are a concise research assistant for a fintech startup.
```

**AGENTS.md** — how it should behave.

```md
Prefer short, factual answers. Cite a source for every non-obvious claim.
Never invent numbers.
```

## Run a session

```ts
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";

const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",
  fs, // this tenant's AgentFS volume
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});

await runtime.init();

const system = runtime.systemPrompt();
const tools = runtime.tools();
// hand both to your model loop
```

Each `tenantId` gets its own agent home. That is the multi-tenancy wall.

## What happens after the session

1. The **curator** reviews the transcript and proposes memory + skills.
2. Proposals land in `pending/` for **human approval**.
3. On approve, they become permanent.
4. The next session starts with those lessons already in the frozen snapshot.

## Next

- [Security & isolation](security.md) — why this is safe enough for SaaS
- [Memory](memory.md) — what the agent remembers
- [Skills & learning](skills-and-learning.md) — how it gets better
- [Sandbox](sandbox.md) — how it executes safely
