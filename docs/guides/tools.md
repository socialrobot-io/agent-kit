# Tools

Tools are functions the model can call during a turn (look up memory, run
bash, call your API, and so on).

`createTenantHome` / `openAgentSession` build a default set. You add or remove
tools in code. The runtime does **not** load tools from an `agent/tools/`
directory.

## Three ways to give the agent powers

| Approach | When to use | How |
| -------- | ----------- | --- |
| Host `SessionTool` | Product APIs (CRM, billing, your backend) | `addTools` on `openSession` / `run` / `stream` |
| Sandbox shell | Files, Unix utils, curl, JS/Python, custom bash cmds | `createTenantHome({ sandbox: { … } })` |
| Skills | Written procedures the model reads | `agent/skills/` (markdown), not executable code |

Prefer a host tool when the work should hit your systems with your auth.
Prefer the sandbox when the agent should explore files or run sandboxed code.
Skills teach *how*; they do not register new function calls.

Sandbox details (curl, `js-exec`, `python3`, `defineCommand`): [Sandbox](sandbox.md).

## Default tools

| Tool | Included when |
| ---- | ------------- |
| `memory` | Always |
| `skills_list`, `skill_view`, `skill_manage` | Always |
| `session_search` | `createTenantHome` (default) or you pass `sessionSearchTool` |
| `bash`, `readFile`, `writeFile` | `createTenantHome` (default) or you pass `sandboxTools` |

Happy path:

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const home = await createTenantHome({ tenantId, agent });
const session = await home.openSession(sessionId, {
  addTools: [weather],
  disableTools: ["skill_manage"],
});
```

## Add your own tool

You need an API key (`AI_GATEWAY_API_KEY`) or a `LanguageModel` you pass in.
This example uses in-memory files. For a tenant volume, see [Hosting](hosting.md).

```ts
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";

const tenantId = "brand-123";
const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are a helpful assistant.");
await fs.writeFile("agent/AGENTS.md", "Be brief.");

const session = await openAgentSession({
  tenantId,
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});

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

const turn = await session.run(
  [{ role: "user", content: "Weather in Paris?" }],
  {
    addTools: [weather],
    disableTools: ["skill_manage"],
  },
);
console.log(turn.text);
```

For streaming chat UIs (`useChat`), call `session.stream` with the same
override options.

## How turn overrides work

| Option | Effect |
| ------ | ------ |
| (omit all) | Use the default tools for this session |
| `addTools` | Add tools. If a name matches a default, your tool replaces it |
| `disableTools` | Remove tools by name |
| `tools` | Use only this list. Ignore defaults, `addTools`, and `disableTools` |

Each `SessionTool` needs `{ name, description, inputSchema, execute }`.

## Search and sandbox without `createTenantHome`

Prefer `createTenantHome` (see [Hosting](hosting.md)). If you wire by hand:

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
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
  sessionSearchTool: createSessionSearchTool(transcripts, tenantId),
  sandboxTools: bash.tools,
});
```

Prefer `addTools` on `session.run` / `home.openSession` over the older
`extraTools` / `extraAiTools` names on low-level `runAgentTurn`.

## Next

- Curl, JS/Python, custom bash commands: [Sandbox](sandbox.md)
- Pick a model or stream replies: [Models](models.md)
- Production volume wiring: [Hosting](hosting.md)
- Runnable JS-in-sandbox demo: [`examples/example-app`](../../examples/example-app) `/code-runner`
