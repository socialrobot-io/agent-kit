# Models

This guide shows how to pick a model and run one agent turn. The kit uses the
[Vercel AI SDK](https://sdk.vercel.ai) (`ai` v7 and `@ai-sdk/gateway`).

## Pick a model

Pass either:

- a `"provider/model"` string on `defineAgent` (resolved through the AI Gateway
  when you run a turn), or
- a ready `LanguageModel` via `createTenantHome({ model })` or
  `openAgentSession({ model })` (any AI SDK provider).

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, resolveModel } from "@socialrobot-io/agent-kit-ai";

// String id on the definition (needs AI_GATEWAY_API_KEY at run time):
const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });

// Or resolve / pass a provider model yourself:
// import { openai } from "@ai-sdk/openai";
// const session = await openAgentSession({
//   tenantId, fs, definition,
//   model: openai("gpt-4o"),
// });

// Low-level helper if you need a LanguageModel outside a session:
const fromGateway = resolveModel("anthropic/claude-sonnet-4-5");
```

| You pass | What happens |
| -------- | ------------ |
| `"provider/model"` on `defineAgent` | Resolved via AI Gateway on `session.run` / `session.stream` |
| `model: LanguageModel` on `openAgentSession` | Used as-is |

## Run a turn

```ts
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const session = await openAgentSession({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});

const turn = await session.run(
  [{ role: "user", content: "Stop being so verbose." }],
  { maxSteps: 8 },
);

console.log(turn.text);
console.log(turn.toolCalls);
```

`maxSteps` caps how many tool-call rounds the model may take (default 8).

Built-in tools write through the same approval rules as the rest of the kit.
To add product tools, see [Tools](tools.md).

## Stream a turn

```ts
const stream = session.stream(messages, { maxSteps: 12 });
```

The example app uses this with AI SDK UI `useChat`.

## Curator model (usually automatic)

`createTenantHome` runs the curator after each turn with `aiCuratorRunner` on
the session model. Toggle with `defineAgent({ config: { curator } })`.

To use a cheaper model, pass `curatorRunner` into `createTenantHome`:

```ts
import { aiCuratorRunner } from "@socialrobot-io/agent-kit-ai";
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const home = await createTenantHome({
  tenantId,
  agent,
  curatorRunner: aiCuratorRunner("anthropic/claude-haiku-4-5"),
});
```

Manual `runBackgroundReview` is only needed when you use bare
`openAgentSession` without `createTenantHome`. See
[Skills & learning](skills-and-learning.md).

Tests use a mock `LanguageModel`. The call path matches
the live path.

## Next

- Approve curator output: [Skills & learning](skills-and-learning.md)
- Production volume: [Hosting](hosting.md)
