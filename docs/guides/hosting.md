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
| AgentFS | The SQLite-backed filesystem ([agentfs.ai](https://www.agentfs.ai/)). |
| `adaptAgentFs` | Small function **in your app** that makes AgentFS look like the kit’s filesystem interface. |

## What your app must do

1. Authenticate the user (cookie, JWT, session, or similar).
2. Map that user to a stable `tenantId`. Never take `tenantId` from the request body alone.
3. Choose a volume path you control, for example `/data/tenants/${tenantId}.db`.
4. Create a `sessionId` for each chat and keep it tied to that tenant.

The kit stores data under the `tenantId` you pass. It does not check whether
that caller is allowed to use it.

## Build the session (step by step)

### A. Bridge AgentFS to the kit

AgentFS has its own `FileSystem` type. The kit uses a smaller interface
(`AgentFsLike`: read, write, list, rename). Put this bridge in your app so the
kit packages do not depend on AgentFS types.

```ts
import type { FileSystem } from "agentfs-sdk";
import type { AgentFsLike } from "@socialrobot-io/agent-kit-core";

function adaptAgentFs(inner: FileSystem): AgentFsLike {
  return {
    async readFile(path) {
      try {
        return await inner.readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeFile(path, content) {
      await inner.writeFile(path, content, "utf8");
    },
    async list(dir) {
      try {
        return await inner.readdir(dir);
      } catch {
        return [];
      }
    },
    async rename(from, to) {
      await inner.rename(from, to);
    },
  };
}
```

You can also copy
[`examples/example-app/src/lib/fs-adapter.ts`](../../examples/example-app/src/lib/fs-adapter.ts).

### B. Open the volume and compose tools

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, resolveModel, runAgentTurn } from "@socialrobot-io/agent-kit-ai";
import {
  openAgentFs,
  serializeAgentFs,
  createTenantBashToolkit,
} from "@socialrobot-io/agent-kit-sandbox";
import {
  FileTranscriptStore,
  assertTenantSession,
  createSessionSearchTool,
} from "@socialrobot-io/agent-kit-sessions";

const tenantId = "brand-123"; // from your auth layer
const sessionId = "chat-abc"; // from your chat API
const volumePath = `/data/tenants/${tenantId}.db`;

// One open handle per volume per process.
const afs = await openAgentFs(volumePath);
serializeAgentFs(afs.fs); // required before concurrent FS use
const fs = adaptAgentFs(afs.fs);

const transcripts = new FileTranscriptStore({ fs });
await transcripts.createSession({
  id: sessionId,
  tenantId,
  source: "chat",
  createdAt: Date.now() / 1000,
});
// Throws if this sessionId belongs to another tenant.
await assertTenantSession(transcripts, tenantId, sessionId);

const bash = await createTenantBashToolkit({ tenantId, agentFs: afs });
const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const search = createSessionSearchTool(transcripts, tenantId, {
  currentSessionId: sessionId,
});

const session = await openAgentSession({
  tenantId,
  fs,
  definition,
  sessionSearchTool: search,
  sandboxTools: bash.tools,
});

const { toolSet } = session.composeTools();
const turn = await runAgentTurn(
  [{ role: "user", content: "Summarize /workspace." }],
  {
    runtime: session.runtime,
    model: resolveModel(definition.model),
    toolSet,
  },
);
```

A full streaming chat with the same shape lives in
[`examples/example-app`](../../examples/example-app).

## Rules you must keep

1. One volume file per tenant. Never open tenant A’s path for tenant B.
2. Do not share one open AgentFS handle across tenants.
3. Call `serializeAgentFs` on the volume you opened before concurrent use.
4. Leave write approval on unless you opt out for a local demo.
5. Call `assertTenantSession` before you load or append history for a `sessionId`.

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
