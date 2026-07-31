# Host an agent in your app

Use this guide when you wire agent-kit into a product: login, one disk file
per customer (tenant), chat history, guarded shell, and a live model turn.

agent-kit is a library. It does not start a server, check cookies, or choose
who may call you. Your app authenticates the user, maps them to a `tenantId`,
then opens a tenant home.

This guide assumes **one machine**: one Node process and one SQLite file per
tenant on local disk. Multi-machine hosting is not ready yet
([roadmap](../roadmap/multi-machine.md)).

## Words used here

| Term | Meaning |
| ---- | ------- |
| `tenantId` | Stable id for one customer’s data. You create it from your login system. |
| Volume | One SQLite file for that tenant. Memory, skills, workspace, chat logs, and audit live here. |
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
2. Mark company-owned skills with frontmatter or `.locked`
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

- volume at `./data/tenants/${tenantId}.db`
- transcripts + `session_search`
- sandbox tools (`bash`, `readFile`, `writeFile`)
- model `anthropic/claude-sonnet-4-5`
- process cache so the same volume path reuses one home

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent"; // from compileAgent in predev / CI

const tenantId = "brand-123"; // from your auth layer
const sessionId = "chat-abc"; // from your chat API

const home = await createTenantHome({ tenantId, agent });
const session = await home.openSession(sessionId);

const turn = await session.run([
  { role: "user", content: "Summarize /workspace." },
]);
```

Plain Node with `agent/` on disk can pass `await loadAgent("./agent")` instead.

### Common overrides

Override only what you need. The rest stays on convention.

```ts
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId,
  agent,
  dataDir: "/var/lib/agents", // or volumePath: "/data/acme.db"
  model: "anthropic/claude-sonnet-4-5", // or a ready LanguageModel
  interactiveApproval: true, // chat UI Approve applies writes
  workspaceFiles: { "README.md": "# hi\n" },
  sandbox: { allowedHosts: ["api.example.com"] }, // hostnames only; or sandbox: false
  // transcripts: false,
});

const session = await home.openSession(sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
});
```

What `createTenantHome` returns:

| Field | What it is |
| ----- | ---------- |
| `home.volume` | The tenant SQLite filesystem (memory, skills, workspace, audit). |
| `home.transcripts` | Chat history store used by `session_search` and the curator. |
| `home.bash` | Guarded shell toolkit (`bash`, `readFile`, `writeFile`). |
| `home.openSession` | Opens one chat with frozen memory for that `sessionId`. |

Most apps only call `openSession`. Use the other fields when you persist
messages yourself, inspect the volume, or call sandbox tools outside a turn.

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

```js
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["agentfs-sdk", "just-bash", "bash-tool"],
};

module.exports = nextConfig;
```

Rules:

1. Set `export const runtime = "nodejs"` in the route or action file. The
   edge runtime cannot load native bindings or local SQLite files.
2. Do not add `@socialrobot-io/*` packages to `serverExternalPackages` when
   you install them from npm. They ship plain JavaScript and bundle safely.
   `examples/example-app` lists them under `transpilePackages` because the
   monorepo maps them to TypeScript source. That setting is workspace-only.
3. If the error names a different native package, add that package to
   `serverExternalPackages`. Known extras: `@tursodatabase/database`,
   `@mongodb-js/zstd`, `node-liblzma`, `better-sqlite3`.

The same `Cannot find native binding` error in plain Node (no bundler) means
the platform package is missing from `node_modules`. See the npm note in
[Getting started](getting-started.md#package-manager-notes).

Reference wiring: [`examples/example-app`](../../examples/example-app) (route
handler, session cache, approval UI, working `serverExternalPackages`).

## Rules you must keep

1. One volume file per tenant. Never open tenant A’s path for tenant B.
2. Do not share one open volume across tenants.
3. Leave write approval on unless you opt out for a local demo.
4. Prefer `home.openSession(sessionId)` so transcript ownership is asserted for you.

| Detail | Fact |
| ------ | ---- |
| What is in the volume | Memory, skills, workspace files, transcripts, audit data |
| Who checks login | Your app. The kit trusts the `tenantId` you pass. |
| Audit trail | Prefer AgentFS timeline or SQL. The kit also records blocked shell commands. |

Optional AgentFS [overlay](https://docs.turso.tech/agentfs/guides/overlay) mode
exists. The default home is the volume itself. Do not mix modes by accident.

## After each turn (curator)

`createTenantHome().openSession` runs the curator after every completed turn
(Hermes-style). It does not block the user reply. Proposals stage under
`pending/` when write approval is on.

Toggle with agent config:

```ts
defineAgent({
  model: "anthropic/claude-sonnet-4-5",
  config: {
    curator: false, // or { mode: "memory" | "skills" | "combined" }
  },
});
```

Default is on (`curator: true`, mode `combined`). Your app still must:

1. Show staged proposals in a UI or ops tool.
2. Call `approvePendingWrites` only when a human accepts them.
3. Open a **new** session to see approved content (the open chat keeps its
   frozen memory snapshot).

Bare `openAgentSession` (without `createTenantHome`) does not auto-run the
curator. Call `runBackgroundReview` yourself in that case.

Details: [Skills & learning](skills-and-learning.md).

## Next

- Add product tools: [Tools](tools.md)
- Choose a model or stream replies: [Models](models.md)
- Shell limits: [Sandbox](sandbox.md)
- Threat model: [Security](security.md)
