# Models

This guide shows how to pick a model and run one agent turn. The kit uses the
[Vercel AI SDK](https://sdk.vercel.ai) (`ai` v7 and `@ai-sdk/gateway`).

## Pick a model

Pass either:

- a `"provider/model"` string (resolved through the AI Gateway), or
- a ready `LanguageModel` from any AI SDK provider package.

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { resolveModel, resolveAgentModel } from "@socialrobot-io/agent-kit-ai";

// Needs AI_GATEWAY_API_KEY, or pass { apiKey, baseURL } into resolveModel.
const fromGateway = resolveModel("anthropic/claude-sonnet-4-5");

// Or pass a provider model through unchanged:
// import { openai } from "@ai-sdk/openai";
// const passedThrough = resolveModel(openai("gpt-4o"));

const fromDefinition = resolveAgentModel(
  defineAgent({ model: "openai/gpt-5" }),
);
```

| You pass | What happens |
| -------- | ------------ |
| `"provider/model"` string | Resolved via AI Gateway |
| Ready `LanguageModel` | Used as-is |

## Run a turn

Preferred path: open a session, compose tools, then call `runAgentTurn`.

```ts
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, resolveModel, runAgentTurn } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const session = await openAgentSession({
  tenantId: "brand-123",
  fs,
  definition,
});

const { toolSet } = session.composeTools();
const turn = await runAgentTurn(
  [{ role: "user", content: "Stop being so verbose." }],
  {
    runtime: session.runtime,
    model: resolveModel(definition.model),
    toolSet,
    maxSteps: 8,
  },
);

console.log(turn.text);
console.log(turn.toolCalls);
```

`maxSteps` caps how many tool-call rounds the model may take (default 8).

Built-in tools write through the same approval rules as the rest of the kit.
To add product tools, see [Tools](tools.md).

## Stream a turn

Use `streamAgentTurn` with the same options. The example app uses this with
AI SDK UI `useChat`.

## Run the curator on a live model

After a chat, you can ask a (usually cheaper) model to propose memory and
skill updates. That is the curator.

```ts
import type { ModelMessage } from "ai";
import { runBackgroundReview } from "@socialrobot-io/agent-kit-curator";
import { aiCuratorRunner } from "@socialrobot-io/agent-kit-ai";

const transcript: ModelMessage[] = [
  { role: "user", content: "Stop being so verbose." },
  { role: "assistant", content: "Got it. I will be brief." },
];

await runBackgroundReview(transcript, {
  memory: session.runtime.memory,
  skills: session.runtime.skills,
  pending: session.runtime.pending,
  writeApprovalEnabled: () => true,
  mode: "combined",
  model: aiCuratorRunner("anthropic/claude-haiku-4-5"),
});
```

Then a human must approve staged writes. See
[Skills & learning](skills-and-learning.md).

Tests and the offline demo use a mock `LanguageModel`. The call path matches
the live path.

## Next

- Approve curator output: [Skills & learning](skills-and-learning.md)
- Production volume: [Hosting](hosting.md)
