# Models & the Agent Loop

`@socialrobot-io/agent-kit-ai` on the [Vercel AI SDK](https://sdk.vercel.ai) (`ai` v7,
`@ai-sdk/gateway`).

## Resolve a model

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { resolveModel, resolveAgentModel } from "@socialrobot-io/agent-kit-ai";

// String id → AI Gateway (needs AI_GATEWAY_API_KEY, or { apiKey, baseURL })
const fromGateway = resolveModel("anthropic/claude-sonnet-4-5");

// Or pass a ready LanguageModel from any AI SDK provider package:
// import { openai } from "@ai-sdk/openai";
// const passedThrough = resolveModel(openai("gpt-4o"));

const fromDefinition = resolveAgentModel(
  defineAgent({ model: "openai/gpt-5" }),
);
```

| Input | Result |
| ----- | ------ |
| `"provider/model"` string | AI Gateway |
| Ready `LanguageModel` | Unchanged |

## Run a turn

```ts
import { AgentSessionRuntime, defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { runAgentTurn } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are helpful.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const tenantId = "brand-123";
const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const runtime = new AgentSessionRuntime({ tenantId, fs, definition });
await runtime.init();

const turn = await runAgentTurn(
  [{ role: "user", content: "Stop being so verbose." }],
  { runtime, definition, maxSteps: 8 },
);

console.log(turn.text);
console.log(turn.toolCalls);
console.log(turn.toolResults);
```

Built-in tools hit the tenant stores (write-approval gate included).

Custom tools: prefer [Tools](tools.md) (`composeTools`). Or pass them on the
same `runtime` / `definition` from above:

```ts
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import { createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";

const myCustomTool: SessionTool = {
  name: "ping",
  description: "Return pong.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ ok: true }),
};

const bash = await createTenantBashToolkit({
  tenantId,
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
});

await runAgentTurn(
  [{ role: "user", content: "Ping." }],
  {
    runtime,
    definition,
    addTools: [myCustomTool],
    addAiTools: bash.tools,
  },
);
```

## Curator on a live model

Reuse `runtime` from **Run a turn** above.

```ts
import type { ModelMessage } from "ai";
import { runBackgroundReview } from "@socialrobot-io/agent-kit-curator";
import { aiCuratorRunner } from "@socialrobot-io/agent-kit-ai";

const transcript: ModelMessage[] = [
  { role: "user", content: "Stop being so verbose." },
  { role: "assistant", content: "Got it. I will be brief." },
];

await runBackgroundReview(transcript, {
  memory: runtime.memory,
  skills: runtime.skills,
  pending: runtime.pending,
  writeApprovalEnabled: () => true,
  mode: "combined",
  model: aiCuratorRunner("anthropic/claude-haiku-4-5"),
});
```

Demo/tests use an offline `LanguageModel` mock. Same code path as live.
