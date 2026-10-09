# `@socialrobot-io/agent-kit-node`

Convention host wiring for agent-kit.

```bash
npm i @socialrobot-io/agent-kit-node ai
```

`ai` (Vercel AI SDK `^7.0.0`) is a peer of this package and of
`@socialrobot-io/agent-kit-ai`. Install it next to the kit.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({ tenantId: "brand-123", agent });
const session = await home.openSession("chat-1");
await session.run([{ role: "user", content: "Hello" }]);
```

## Defaults

| Piece | Default |
| ----- | ------- |
| Storage | AgentFS file at `./data/tenants/${tenantId}.db` |
| Model | `anthropic/claude-sonnet-4-5` |
| Transcripts | on (`session_search` wired) |
| Sandbox | on (`bash`, `readFile`, `writeFile`) |
| Cache | storage opens once per key per process; each kit keeps its own home |

## Home fields

| Field | What it is |
| ----- | ---------- |
| `home.volume` | Privileged tenant filesystem (host code only) |
| `home.location` | File path or backend label |
| `home.transcripts` | Chat history for search |
| `home.bash` | Guarded shell toolkit |
| `home.openSession` | Open one chat (frozen memory; curator after each turn) |
| `home.stores()` | Memory, skills, and pending stores for host pages |
| `home.review(job)` | Run one curator review now (queue workers) |
| `home.recordTurn(sessionId, input)` | Save one turn for `session_search` and hand it to the curator |

Curator default is on (`defineAgent` `config.curator`). Disable with
`config.curator: false`. Apply curator proposals immediately (no pending UI)
with `config.curator: { autoApprove: true }`.

## Overrides

```ts
createTenantHome({
  tenantId,
  agent,
  dataDir: "/var/lib/agents",
  // storage: postgresStorage({ db }), // many processes (see below)
  // curatorQueue: (job) => queue.add("curator", job), // review in a worker
  // curatorModel: "anthropic/claude-haiku-4-5",
  model: "anthropic/claude-sonnet-4-5",
  interactiveApproval: true,
  workspaceFiles: { "README.md": "# hi\n" },
  sandbox: { allowedHosts: ["api.example.com"] },
});

home.openSession(sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
  // autoReview: false, // you call home.recordTurn, which reviews the turn
});
```

## Postgres storage

Import from the `./postgres` subpath. It has no driver dependency: wrap the
client of the driver that you use.

```ts
import pg from "pg";
import { createAgentKit } from "@socialrobot-io/agent-kit-node";
import { fromPg, postgresStorage } from "@socialrobot-io/agent-kit-node/postgres";

const db = fromPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
export const kit = createAgentKit({ agent, storage: postgresStorage({ db }), sandbox: false });
```

Docs: [Hosting](../../docs/guides/hosting.md) · [Storage](../../docs/guides/storage.md).
