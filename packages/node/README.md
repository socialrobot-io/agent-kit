# `@socialrobot-io/agent-kit-node`

Convention host wiring for agent-kit.

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
| Volume | `./data/tenants/${tenantId}.db` |
| Model | `anthropic/claude-sonnet-4-5` |
| Transcripts | on (`session_search` wired) |
| Sandbox | on (`bash`, `readFile`, `writeFile`) |
| Cache | one home per volume path per process |

## Home fields

| Field | What it is |
| ----- | ---------- |
| `home.volume` | Tenant SQLite filesystem |
| `home.transcripts` | Chat history for search |
| `home.bash` | Guarded shell toolkit |
| `home.openSession` | Open one chat (frozen memory; curator after each turn) |

Curator default is on (`defineAgent` `config.curator`). Disable with
`config.curator: false`.

## Overrides

```ts
createTenantHome({
  tenantId,
  agent,
  dataDir: "/var/lib/agents",
  // volumePath: "/data/acme.db",
  model: "anthropic/claude-sonnet-4-5",
  interactiveApproval: true,
  workspaceFiles: { "README.md": "# hi\n" },
  sandbox: { allowedHosts: ["api.example.com"] },
});

home.openSession(sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
});
```

Docs: [Hosting](../../docs/guides/hosting.md).
