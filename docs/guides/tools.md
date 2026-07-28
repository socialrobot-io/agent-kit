# Tools

Defaults from `openAgentSession` / the agent loop. Register custom tools in
code. The runtime does not scan `agent/tools/`.

| Tool | When |
| ---- | ---- |
| `memory` | Always |
| `skills_list`, `skill_view`, `skill_manage` | Always |
| `session_search` | You pass `sessionSearchTool` |
| `bash`, `readFile`, `writeFile` | You pass `sandboxTools` |

## Add a tool

Needs `AI_GATEWAY_API_KEY` (or pass your own `LanguageModel`). `InMemoryFs` is
fine for a local try; production volumes: [Hosting](hosting.md).

```ts
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, runAgentTurn, resolveModel } from "@socialrobot-io/agent-kit-ai";

const tenantId = "brand-123";
const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are a helpful assistant.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const session = await openAgentSession({ tenantId, fs, definition });

const weather: SessionTool = {
  name: "weather",
  description: "Short weather summary for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  },
  execute: async (args) => ({
    ok: true,
    city: String(args.city ?? ""),
    summary: "clear",
  }),
};

const { toolSet } = session.composeTools({
  addTools: [weather],
  disableTools: ["skill_manage"],
});

const turn = await runAgentTurn(
  [{ role: "user", content: "Weather in Paris?" }],
  {
    runtime: session.runtime,
    model: resolveModel(definition.model),
    toolSet,
  },
);
console.log(turn.text);
```

For streaming / `useChat`, use `streamAgentTurn` the same way (pass `runtime`, `model`,
`toolSet`).

| Option | Effect |
| ------ | ------ |
| _(omit)_ | Composed defaults |
| `addTools` | Add on top of defaults. Same `name` replaces the default |
| `disableTools` | Remove by name (defaults and prior adds) |
| `tools` | Full replace. Ignores defaults, `addTools`, and `disableTools` |

`SessionTool` shape: `{ name, description, inputSchema, execute }`.

## Optional: search + sandbox on the same session

Reuse `tenantId`, `fs`, and `definition` from the example above.

```ts
import { createSessionSearchTool, FileTranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import { createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";

const transcripts = new FileTranscriptStore({ fs });
const bash = await createTenantBashToolkit({
  tenantId,
  files: { "README.md": "# workspace\n" },
  destination: "/workspace",
});

const sessionWithExtras = await openAgentSession({
  tenantId,
  fs,
  definition,
  sessionSearchTool: createSessionSearchTool(transcripts, tenantId),
  sandboxTools: bash.tools,
});
```

Prefer `addTools` over legacy `extraTools` / `extraAiTools`.
