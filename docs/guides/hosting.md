# Hosting (local single-node)

Your app owns auth, `tenantId`, and volume paths. agent-kit is a library.
Multi-machine is deferred: [roadmap](../roadmap/multi-machine.md).

## Checklist

1. Authenticate the user (cookie, JWT, …).
2. Map auth → stable `tenantId`. Never trust a client-supplied tenant id.
3. Open one AgentFS volume per tenant (SQLite path you control).
4. Do not share an open volume handle across tenants.
5. One `AgentFS.open` per volume per process; serialize FS ops
   (`openAgentFs`, `serializeAgentFs` from `@socialrobot-io/agent-kit-sandbox`).
6. Keep write approval on unless you explicitly opt out.
7. Bind `sessionId` to the tenant before reading history
   (`assertTenantSession` from `@socialrobot-io/agent-kit-sessions`).

## Composition

`adaptAgentFs` is host code (AgentFS SDK → `@socialrobot-io/agent-kit-core` `AgentFsLike`).
Copy from `examples/example-app/src/lib/fs-adapter.ts` or use the stub below.

```ts
import type { FileSystem } from "agentfs-sdk";
import type { AgentFsLike } from "@socialrobot-io/agent-kit-core";
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";
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

const tenantId = "brand-123";       // from your auth layer
const sessionId = "chat-abc";       // from your chat UI / API
const volumePath = `/data/tenants/${tenantId}.db`;

const afs = await openAgentFs(volumePath);
serializeAgentFs(afs.fs);
const fs = adaptAgentFs(afs.fs);

const transcripts = new FileTranscriptStore({ fs });
await transcripts.createSession({
  id: sessionId,
  tenantId,
  source: "chat",
  createdAt: Date.now() / 1000,
});
await assertTenantSession(transcripts, tenantId, sessionId);

const bash = await createTenantBashToolkit({ tenantId, agentFs: afs });

const session = await openAgentSession({
  tenantId,
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
  sessionSearchTool: createSessionSearchTool(transcripts, tenantId, {
    currentSessionId: sessionId,
  }),
  sandboxTools: bash.tools,
});
```

| Rule | Fact |
| ---- | ---- |
| One volume file per tenant | Memory, skills, workspace, transcripts, audit share that file |
| Host owns authz | agent-kit does not verify JWTs or cookies |
| Audit | Prefer AgentFS timeline/SQL; kit adds guardrail denial records |
| Overlay | Optional ([AgentFS overlay](https://docs.turso.tech/agentfs/guides/overlay)). Default home is the volume. Do not mix modes by accident |

Tool overrides: [Tools](tools.md).
