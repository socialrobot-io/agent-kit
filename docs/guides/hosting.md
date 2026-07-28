# Host an agent in your app

Use this guide when you wire agent-kit into a product: login, one disk file
per customer (tenant), chat history, guarded shell, and a live model turn.

agent-kit is a library. It does not start a server, check cookies, or choose
disk paths. Your app does those jobs, then calls the kit.

This guide assumes **one machine**: one Node process and one SQLite file per
tenant on local disk. Multi-machine hosting is not ready yet
([roadmap](../roadmap/multi-machine.md)).

## Words used here

| Term | Meaning |
| ---- | ------- |
| `tenantId` | Stable id for one customer’s data. You create it from your login system. |
| Volume | One SQLite file for that tenant. Memory, skills, workspace, chat logs, and audit live here. |
| `sessionId` | Id for one chat conversation. |
| `openTenantVolume` | Opens that file and returns a kit-ready `volume` object. |

## What your app must do

1. Authenticate the user (cookie, JWT, session, or similar).
2. Map that user to a stable `tenantId`. Never take `tenantId` from the request body alone.
3. Choose a volume path you control, for example `/data/tenants/${tenantId}.db`.
4. Create a `sessionId` for each chat and keep it tied to that tenant.

The kit stores data under the `tenantId` you pass. It does not check whether
that caller is allowed to use it.

## Build the session

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";
import {
  openTenantVolume,
  createTenantBashToolkit,
} from "@socialrobot-io/agent-kit-sandbox";
import {
  FileTranscriptStore,
  assertTenantSession,
  createSessionSearchTool,
} from "@socialrobot-io/agent-kit-sessions";

const tenantId = "brand-123"; // from your auth layer
const sessionId = "chat-abc"; // from your chat API

// One SQLite file per tenant. Pass this volume into session, transcripts, bash.
const volume = await openTenantVolume(`/data/tenants/${tenantId}.db`);

const transcripts = new FileTranscriptStore({ fs: volume });
await transcripts.createSession({
  id: sessionId,
  tenantId,
  source: "chat",
  createdAt: Date.now() / 1000,
});
// Throws if this sessionId belongs to another tenant.
await assertTenantSession(transcripts, tenantId, sessionId);

const bash = await createTenantBashToolkit({ tenantId, volume });
const search = createSessionSearchTool(transcripts, tenantId, {
  currentSessionId: sessionId,
});

const session = await openAgentSession({
  tenantId,
  fs: volume,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
  sessionSearchTool: search,
  sandboxTools: bash.tools,
});

const turn = await session.run([
  { role: "user", content: "Summarize /workspace." },
]);
```

A full streaming chat with the same shape lives in
[`examples/example-app`](../../examples/example-app).

## Rules you must keep

1. One volume file per tenant. Never open tenant A’s path for tenant B.
2. Do not share one open volume across tenants.
3. Leave write approval on unless you opt out for a local demo.
4. Call `assertTenantSession` before you load or append history for a `sessionId`.

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
