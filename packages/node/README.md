# `@socialrobot-io/agent-kit-node`

Convention host wiring for agent-kit.

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const home = await createTenantHome({ tenantId: "brand-123" });
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

## Overrides

```ts
createTenantHome({
  tenantId,
  dataDir: "/var/lib/agents",
  // volumePath: "/data/acme.db",
  model: "anthropic/claude-sonnet-4-5",
  interactiveApproval: true,
  workspaceFiles: { "README.md": "# hi\n" },
  sandbox: { allowedHosts: ["https://api.example.com"] },
});

home.openSession(sessionId, {
  addTools: [myTool],
  disableTools: ["skill_manage"],
});
```

`home.volume`, `home.transcripts`, and `home.bash` stay available. For custom
composition, use the leaf packages directly.

Docs: [Hosting](../../docs/guides/hosting.md).
