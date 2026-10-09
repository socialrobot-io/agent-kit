# Host an agent in your app

Use this guide when you wire agent-kit into a product: login, one disk file
per customer (tenant), chat history, guarded shell, and a live model turn.

agent-kit is a library. It does not start a server, check cookies, or choose
who may call you. Your app authenticates the user, maps them to a `tenantId`,
then opens a tenant home.

By default each tenant gets one AgentFS SQLite file on local disk, opened by
one Node process. When several processes or machines serve the same tenant,
use Postgres storage. See [Storage](storage.md).

## Words used here

| Term | Meaning |
| ---- | ------- |
| `tenantId` | Stable id for one customer’s data. You create it from your login system. |
| Volume | The agent-home filesystem of one tenant: agent files, memory, skills, and pending writes. By default one AgentFS SQLite file, which also holds the workspace and chat logs. |
| Storage adapter | Where volumes and transcripts live. Default AgentFS. See [Storage](storage.md). |
| `sessionId` | Id for one chat conversation. |
| `createTenantHome` | Convention entry: opens volume + transcripts + sandbox and caches per process. |

## Agent install

Author identity and skills under `agent/`. Compile once, import everywhere.
Sessions already use a policy-wrapped FS (`createAgentFs`).

```js
// scripts/compile-agent.mjs — run with: node scripts/compile-agent.mjs
import { compileAgent } from "@socialrobot-io/agent-kit-node";

await compileAgent({
  dir: "./agent",
  outFile: "./src/generated/agent.ts", // or .json
});
```

Wire that script into `predev` / `prebuild` in your app `package.json`.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId,
  agent,
  sandbox: {
    secrets: [process.env.TENANT_API_KEY!],
    allowedHosts: ["api.company.com"],
  },
});

const session = await home.openSession(sessionId);
```

Skill locking (see [Skills & learning](skills-and-learning.md)):

| Source | Locked? |
| ------ | ------- |
| `agent/skills/*` | Only if `locked`/`pinned`/`bundled` or `.locked` |
| Created at runtime | Never (approval still applies) |

### Checklist

1. Author `agent/` and run `compileAgent` in CI / predev
2. Mark company-owned skills with frontmatter or `.locked`. Each boot installs the bundle again and removes what you took out of it (see [Bundle updates](skills-and-learning.md#bundle-updates))
3. Pass sandbox `secrets` / `allowedHosts` at home creation
4. Enable `javascript` / `python` on `sandbox` if the agent should run `js-exec` / `python3`
5. Add product tools with `addTools` (see [Tools](tools.md))
6. Do not give the agent the raw volume write handle for tools

See also: [Sandbox](sandbox.md) · [Security](security.md) · [Company envelope PRD](../roadmap/company-envelope-prd.md).
## What your app must do

1. Authenticate the user (cookie, JWT, session, or similar).
2. Map that user to a stable `tenantId`. Never take `tenantId` from the request body alone.
3. Create a `sessionId` for each chat and keep it tied to that tenant.

The kit stores data under the `tenantId` you pass. It does not check whether
that caller is allowed to use it.

## Happy path

Install `@socialrobot-io/agent-kit-node` and its peer `ai` (Vercel AI SDK).
Defaults:

- AgentFS volume at `./data/tenants/${tenantId}.db`
- transcripts + `session_search`
- sandbox tools (`bash`, `readFile`, `writeFile`)
- model `anthropic/claude-sonnet-4-5`
- process cache: each storage key (for AgentFS, the volume path) opens once per
  process. Every kit on that key shares the opened storage and keeps its own
  options

Most apps want `createAgentKit`: one object that opens a tenant home (cached
per process, bounded by the number of tenants) and a chat session on demand.
**Stateless by default** — each `kit.session(tenantId, sessionId)` call opens
a fresh session from disk; state lives in the volume + transcripts, not in
memory. Set `maxSessions` to opt into a per-chat LRU cache for the perf win.

```ts
// lib/kit.ts
import { createAgentKit, loadAgent } from "@socialrobot-io/agent-kit-node";

export const kit = createAgentKit({
  agent: await loadAgent("chat"),
  // model defaults to anthropic/claude-sonnet-4-5
});

// in a route (stateless — fresh session each call):
const session = await kit.session(tenantId, sessionId);
const turn = await session.run([{ role: "user", content: "Summarize /workspace." }]);
```

Load agents with `await loadAgent("chat")`. That opens
`<app-root>/agents/chat` by default. Under Next.js, wrap the config with
`withAgentKit` from `@socialrobot-io/agent-kit-next` (see below): it sets the
agents folder once for both file tracing and `loadAgent`.

### Advanced: `createTenantHome`

When you need the pieces (custom volume path, transcript store, sandbox
secrets inspected outside a turn), drop down to `createTenantHome`. The kit
uses it internally.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({ tenantId, agent });
const session = await home.openSession(sessionId);

const turn = await session.run([
  { role: "user", content: "Summarize /workspace." },
]);
```

### Common overrides

Override only what you need. The rest stays on convention. Both `createAgentKit`
and `createTenantHome` accept these.

```ts
const kit = createAgentKit({
  agent: await loadAgent("chat"),
  dataDir: "/var/lib/agents", // or storage: postgresStorage({ db })
  model: "anthropic/claude-sonnet-4-5", // or a ready LanguageModel
  interactiveApproval: true, // chat UI Approve applies writes
  workspaceFiles: { "README.md": "# hi\n" },
  sandbox: { allowedHosts: ["api.example.com"] }, // hostnames only; or sandbox: false
  // transcripts: false,
  // curatorModel: "anthropic/claude-haiku-4-5", // cheaper review model
  // curatorQueue: (job) => queue.add("curator", job), // review in a worker
});

// per-chat overrides via the third argument:
const session = await kit.session(tenantId, sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
});
```

What `kit.home(tenantId)` / `createTenantHome` returns:

| Field | What it is |
| ----- | ---------- |
| `home.volume` | The privileged tenant filesystem (agent files, memory, skills, pending). Host code only. |
| `home.location` | Where the data lives: a file path or a backend label. |
| `home.agentFs` | AgentFS handle, when the storage is AgentFS. |
| `home.transcripts` | Chat history store used by `session_search`. |
| `home.bash` | Guarded shell toolkit (`bash`, `readFile`, `writeFile`). |
| `home.openSession` | Opens one chat with frozen memory for that `sessionId`. |
| `home.stores()` | Fresh memory, skill, and pending stores for host pages (for example "what the agent remembers"). |
| `home.review(job)` | Runs one curator review now (queue workers, host events). |
| `home.recordTurn(sessionId, input)` | Saves one turn as plain text and hands the same text to the curator. `kit.recordTurn(tenantId, sessionId, input)` does the same. |

Most apps only call `openSession`. Use the other fields when you persist
messages yourself, inspect the volume, or call sandbox tools outside a turn.

### Save turns for search and review

The kit does not save chat messages to `home.transcripts` for you. When you
want `session_search` to find them, call `recordTurn` after each turn:

```ts
const session = await kit.session(tenantId, sessionId, { autoReview: false });
// ... stream the reply ...
await kit.recordTurn(tenantId, sessionId, {
  messages: [
    { id: userMessageId, role: "user", content: userText },
    { id: replyId, role: "assistant", content: replyText },
  ],
  context: earlierMessages, // optional: the curator also reads these
});
```

You decide what `content` holds. Put in the text that a person must be able
to find later. For example, if your agent sends results through a tool, put
the tool output in the reply text. Message ids make the call safe to repeat.

`recordTurn` also hands the same text to the curator, so set
`autoReview: false` on the session. Without it, the curator reviews the turn
two times. The automatic review reads only the text parts of the model
messages and the final reply text. It does not read tool calls.

A full streaming chat with the same shape lives in
[`examples/example-app`](../../examples/example-app).

## Next.js (App Router)

agent-kit works in App Router route handlers and server actions on the
`nodejs` runtime. Turbopack and webpack cannot bundle the native bindings that
agent-kit loads at runtime:

- `agentfs-sdk` loads `@tursodatabase/database`, which loads a per-platform
  `.node` package (`@tursodatabase/database-linux-x64-gnu` and similar).
- `just-bash` can load optional native helpers for archive commands
  (`@mongodb-js/zstd`, and `node-liblzma` when built on the host).

Keep these packages outside the bundle. When they are bundled, the route
fails at module evaluation with `Error: Cannot find native binding`.

Use `@socialrobot-io/agent-kit-next` so you do not hand-tune tracing:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withAgentKit } from "@socialrobot-io/agent-kit-next";

const nextConfig: NextConfig = {};

// Default: agents/ next to app/
export default withAgentKit(nextConfig);

// Custom folder — still loadAgent("chat"):
// withAgentKit(nextConfig, { agentsDir: "src/agents" })
```

`withAgentKit` merges:

- `serverExternalPackages`: `agentfs-sdk`, `just-bash`, `bash-tool`
- `outputFileTracingIncludes["/*"]`: `./{agentsDir}/**/*`
- `env.AGENT_KIT_AGENTS_DIR`: same `agentsDir` (so `loadAgent("chat")` matches tracing)

The kit loads the sandbox package (AgentFS, just-bash) only when a home opens
an AgentFS volume or creates bash tools. With Postgres storage and
`sandbox: false`, it never loads those native packages. Keep `withAgentKit`
anyway, so the build still works when you turn the sandbox on later.

Rules:

1. Set `export const runtime = "nodejs"` in the route or action file. The
   edge runtime cannot load native bindings or local SQLite files.
2. Do not add `@socialrobot-io/*` packages to `serverExternalPackages` when
   you install them from npm. They ship plain JavaScript and bundle safely.
   `examples/example-app` lists them under `transpilePackages` because the
   monorepo maps them to TypeScript source. That setting is workspace-only.
3. If the error names a different native package, pass it through
   `withAgentKit(config, { serverExternalPackages: ["better-sqlite3"] })`.

The same `Cannot find native binding` error in plain Node (no bundler) means
the platform package is missing from `node_modules`. See the npm note in
[Getting started](getting-started.md#package-manager-notes).

Reference wiring: [`examples/example-app`](../../examples/example-app).

## Rules you must keep

1. One volume per tenant. Never open tenant A’s path for tenant B. The kit
   throws when a second tenant uses a storage key that is already open.
2. Do not share one open volume across tenants.
3. Leave write approval on unless you opt out for a local demo. Use
   `curator.autoApprove` when only curator proposals should skip human review.
4. Prefer `home.openSession(sessionId)` so transcript ownership is asserted for you.

| Detail | Fact |
| ------ | ---- |
| What is in the volume | Agent files, memory, skills, pending writes. With AgentFS also workspace files, transcripts, and audit data. |
| Who checks login | Your app. The kit trusts the `tenantId` you pass. |
| Audit trail | Prefer AgentFS timeline or SQL. The kit also records blocked shell commands. |

Optional AgentFS [overlay](https://docs.turso.tech/agentfs/guides/overlay) mode
exists. The default home is the volume itself. Do not mix modes by accident.

## After each turn (curator)

`createTenantHome().openSession` runs the curator after every completed turn
(Hermes-style). It does not block the user reply. Proposals stage under
`pending/` when write approval is on and `curator.autoApprove` is off.

Toggle with agent config:

```ts
defineAgent({
  model: "anthropic/claude-sonnet-4-5",
  config: {
    // curator: false,
    // curator: { mode: "memory" | "skills" | "combined" },
    // curator: { autoApprove: true }, // apply curator proposals; no pending UI
  },
});
```

Default is on (`curator: true`, mode `combined`, `autoApprove` false). Pick one
host posture:

1. **Human review:** show staged proposals in a UI or ops tool, then call
   `approvePendingWrites` when a human accepts them.
2. **Trust curator:** set `curator: { autoApprove: true }` when end users are
   not suited to accept or discard suggestions. No pending UI for curator
   output. In-chat agent writes still follow `writeApproval`.
3. **Disable curator:** set `curator: false` if you do not want the learning
   loop.

Approved or auto-applied content shows up in a **new** session (the open chat
keeps its frozen memory snapshot).

To run reviews in a worker instead of the web process, pass `curatorQueue`.
The kit hands a JSON `CuratorJob` to it after each turn. The worker calls
`kit.review(job)` with the same agent and storage. See
[Storage](storage.md#run-the-curator-in-a-worker).

To review the text that you save instead of the raw model messages, open the
session with `autoReview: false` and call `recordTurn`. See
[Save turns for search and review](#save-turns-for-search-and-review).

Bare `openAgentSession` (without `createTenantHome`) does not auto-run the
curator. Call `runBackgroundReview` yourself in that case.

Details: [Skills & learning](skills-and-learning.md).

## Next

- Run on Postgres or with a curator worker: [Storage](storage.md)
- Add product tools: [Tools](tools.md)
- Choose a model or stream replies: [Models](models.md)
- Shell limits: [Sandbox](sandbox.md)
- Threat model: [Security](security.md)
