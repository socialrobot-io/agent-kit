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

```bash
# any host — Node script, no Next APIs
bun -e '
import { compileAgent } from "@socialrobot-io/agent-kit-node";
await compileAgent({
  dir: "./agent",
  outFile: "./src/generated/agent.ts", // or .json
});
'
```

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
4. Add product tools with `addTools`
5. Do not give the agent the raw volume write handle for tools

See also: [Security](security.md) · [Company envelope PRD](../roadmap/company-envelope-prd.md).
## What your app must do

1. Authenticate the user (cookie, JWT, session, or similar).
2. Map that user to a stable `tenantId`. Never take `tenantId` from the request body alone.
3. Create a `sessionId` for each chat and keep it tied to that tenant.

The kit stores data under the `tenantId` you pass. It does not check whether
that caller is allowed to use it.

## Happy path

Install `@socialrobot-io/agent-kit-node`. Defaults:

- volume at `./data/tenants/${tenantId}.db`
- transcripts + `session_search`
- sandbox tools (`bash`, `readFile`, `writeFile`)
- model `anthropic/claude-sonnet-4-5`
- process cache so the same volume path reuses one home

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const tenantId = "brand-123"; // from your auth layer
const sessionId = "chat-abc"; // from your chat API

const home = await createTenantHome({ tenantId });
const session = await home.openSession(sessionId);

const turn = await session.run([
  { role: "user", content: "Summarize /workspace." },
]);
```

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
  sandbox: { allowedHosts: ["https://api.example.com"] }, // or sandbox: false
  // transcripts: false,
});

const session = await home.openSession(sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
});
```

`home.volume`, `home.transcripts`, and `home.bash` stay available for custom
composition. Low-level APIs (`openTenantVolume`, `openAgentSession`, …) remain
in their packages when you need to wire differently.

A full streaming chat with the same shape lives in
[`examples/example-app`](../../examples/example-app).

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

## After the chat turn

A chat turn does not write durable memory by itself.

1. Run the curator (`runBackgroundReview`) on the transcript. It may write
   proposals under `pending/`.
2. Show those proposals in your UI or ops tool.
3. Call `approvePendingWrites` only when a human accepts them.
4. The **next** session includes approved content. The current session’s
   memory snapshot does not change while that chat is open.

API and example: [Skills & learning](skills-and-learning.md).

## Next

- Add product tools: [Tools](tools.md)
- Choose a model or stream replies: [Models](models.md)
- Shell limits: [Sandbox](sandbox.md)
- Threat model: [Security](security.md)
