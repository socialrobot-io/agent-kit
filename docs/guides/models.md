# Models

This guide shows how to pick a model and run one agent turn. The kit uses the
[Vercel AI SDK](https://sdk.vercel.ai) (`ai` v7). Install `ai` next to the kit:
it is a peer of `@socialrobot-io/agent-kit-ai` and
`@socialrobot-io/agent-kit-node`.

## Pick a model

**1. Preferred:** pass a ready `LanguageModel` from any AI SDK provider.

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId: "brand-123",
  agent,
  model: anthropic("claude-sonnet-4-5"),
});
```

Works the same on `openAgentSession({ model })`. Use any provider package
(`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/deepseek`, `@ai-sdk/google`,
…). Auth is whatever that provider expects (for example `ANTHROPIC_API_KEY`).

**2. Optional:** pass a `"provider/model"` string and let the
[Vercel AI Gateway](https://vercel.com/ai-gateway) resolve it. Set
`AI_GATEWAY_API_KEY` before the first turn.

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, resolveModel } from "@socialrobot-io/agent-kit-ai";

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });

// Or resolve a LanguageModel yourself:
const fromGateway = resolveModel("anthropic/claude-sonnet-4-5");
```

| You pass | What happens |
| -------- | ------------ |
| `model: LanguageModel` on `createTenantHome` / `openAgentSession` | Used as-is (any AI SDK provider) |
| `"provider/model"` on `defineAgent` | Resolved via AI Gateway on `session.run` / `session.stream` (needs `AI_GATEWAY_API_KEY`) |

## Run a turn

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const session = await openAgentSession({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: anthropic("claude-sonnet-4-5") }),
});

const turn = await session.run(
  [{ role: "user", content: "Stop being so verbose." }],
  { maxSteps: 8 },
);

console.log(turn.text);
console.log(turn.toolCalls); // AI SDK TypedToolCall[]
console.log(turn.usage);
```

`maxSteps` is a convenience for `stopWhen: stepCountIs(n)` (default 8). Turn
options are typed from the AI SDK: `session.run` accepts
`generateText` options, `session.stream` accepts `streamText` options
(`temperature`, `abortSignal`, `providerOptions`, `telemetry`, `maxRetries`,
`onFinish` / `onEnd`, `prepareStep`, …). Results are the SDK result types.

Built-in tools write through the same approval rules as the rest of the kit.
To add product tools, see [Tools](tools.md).

## Stream a turn

```ts
const stream = session.stream(messages, {
  maxSteps: 12,
  temperature: 0.2,
  abortSignal: controller.signal,
});
```

`session.stream` returns the AI SDK `StreamTextResult`. For chat UI, wrap
`result.stream` with `toUIMessageStream` + `createUIMessageStreamResponse`
(see the example app).

## Curator model (usually automatic)

`createTenantHome` runs the curator after each turn with `aiCuratorRunner` on
the session model. Toggle with `defineAgent({ config: { curator } })`.

To use a cheaper model, pass `curatorRunner` into `createTenantHome`:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { aiCuratorRunner } from "@socialrobot-io/agent-kit-ai";
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const home = await createTenantHome({
  tenantId,
  agent,
  curatorRunner: aiCuratorRunner(anthropic("claude-haiku-4-5")),
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
