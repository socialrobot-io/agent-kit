# Models & the Agent Loop

How `defineAgent({ model })` becomes a live model, and how the loop runs.
Provided by `@agent-kit/ai`, built on the [Vercel AI SDK](https://sdk.vercel.ai)
(`ai` v7 + `@ai-sdk/gateway`).

## From a string to a live model

`defineAgent({ model: "anthropic/claude-sonnet-4-5" })` stores a **string id**.
`@agent-kit/ai` resolves it into a ready `LanguageModel`:

```ts
import { resolveModel, resolveAgentModel } from "@agent-kit/ai";

resolveModel("anthropic/claude-sonnet-4-5");        // AI Gateway LanguageModel
resolveModel(myOpenAIModel);                        // passed through unchanged
resolveAgentModel(defineAgent({ model: "openai/gpt-5" }));
```

- **String ids** (`"provider/model"`) resolve through the **AI Gateway**, which
  routes to OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, Azure,
  Bedrock, and more with a single `AI_GATEWAY_API_KEY`.
- **A ready `LanguageModel`** (from any provider package, or your own) is
  returned as-is.

Set `AI_GATEWAY_API_KEY` in the environment, or pass `{ apiKey, baseURL }` to
target a self-hosted gateway / proxy.

## Running a turn

`runAgentTurn` is the loop: it hands the runtime's frozen system prompt and the
Hermes tool surface to `generateText`, lets the model call tools until it stops
(bounded by `stopWhen`), and returns the result.

```ts
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";
import { runAgentTurn } from "@agent-kit/ai";

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const runtime = new AgentSessionRuntime({ tenantId, fs, definition });
await runtime.init();

const turn = await runAgentTurn(
  [{ role: "user", content: "Stop being so verbose." }],
  { runtime, definition, maxSteps: 8 },
);

turn.text;        // the model's reply
turn.toolCalls;   // e.g. [{ name: "memory", args: { action: "add", … } }]
turn.toolResults; // the tool outputs
```

Under the hood the runtime's `tools()` are adapted to an AI SDK `ToolSet` with
`toAiTools`, so `memory` / `skills_list` / `skill_view` / `skill_manage` run
against the tenant's live stores — including the write-approval gate.

### Bring your own tools

```ts
await runAgentTurn(messages, {
  runtime,
  definition,
  extraTools: [myCustomTool], // SessionTool[] merged over Hermes
  extraAiTools: bashToolkit.tools, // AI SDK ToolSet (bash-tool, etc.)
});
```

`extraAiTools` is how you mount [`bash-tool`](https://github.com/vercel-labs/bash-tool)
tools from `@agent-kit/sandbox` (`createTenantBashToolkit`).

## The curator on a live model

The curator package expects a `CuratorModelRunner`. `aiCuratorRunner` builds one
on a live model, so the background review reads the real transcript and emits
real `memory` / `skill_manage` calls:

```ts
import { runBackgroundReview } from "@agent-kit/curator";
import { aiCuratorRunner } from "@agent-kit/ai";

const outcome = await runBackgroundReview(transcript, {
  memory, skills, pending,
  writeApprovalEnabled: () => true,
  mode: "combined",
  model: aiCuratorRunner("anthropic/claude-haiku-4-5"), // a cheap model is fine
});
```

## Offline by default

The demo and all tests use an **offline mock** implementing the same
`LanguageModel` interface — no network, no keys. The live path is the identical
code pointed at a real model, which is why the whole suite stays deterministic.
