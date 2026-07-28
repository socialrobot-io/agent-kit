<div align="center">

<img src="docs/assets/hero.png" alt="agent-kit: self-improving AI agents" width="100%"/>

<br/>

### Production-grade agents.<br/>Secure. Sandboxed. Self-improving.

A TypeScript toolkit for shipping AI agents that are safe enough for multi-tenant SaaS.
Curated memory, human-gated learning, and a real execution sandbox.

[![npm](https://img.shields.io/npm/v/%40socialrobot-io%2Fagent-kit-core.svg)](https://www.npmjs.com/package/@socialrobot-io/agent-kit-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-7C5CFF.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Nx](https://img.shields.io/badge/Nx-monorepo-143055.svg)](https://nx.dev)
[![Bun](https://img.shields.io/badge/Bun-runtime-F9F1E1.svg)](https://bun.sh)

[Why](#why) · [Install](#install) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Security](#security) · [Docs](docs/)

</div>

---

## Why

Most agent frameworks optimize for demos. agent-kit optimizes for shipping
agents into production, where one mistake can delete files, leak secrets, or
cross tenant boundaries.

| Pillar | What you get |
| ------ | ------------ |
| **Secure by default** | Prompt-injection, promptware, and exfiltration scanning on every memory and skill write. Threats never reach the system prompt. |
| **Sandboxed execution** | Per-tenant [AgentFS](https://www.agentfs.ai/) volumes and [bash-tool](https://github.com/vercel-labs/bash-tool) guardrails. Destructive commands, secret exfil, and non-allowlisted network egress are blocked before they run. |
| **Production multi-tenancy** | One isolated filesystem, memory, skill library, transcript store, and audit trail per tenant. A bug in tenant A cannot touch tenant B. |
| **Self-improving under approval** | A background curator distills sessions into durable memory and reusable skills. Writes stage for human review. They are never applied silently. |

Learning without a sandbox is a liability. A sandbox without learning is just a
cage. agent-kit is both.

It is a **library**, not a hosted service. Author an agent as a directory, hand
the runtime a per-tenant filesystem, and the production stack comes with it.

---

## Install

Production stack (multi-tenant volume, sandbox, transcripts, live model loop):

```bash
npm i @socialrobot-io/agent-kit-core @socialrobot-io/agent-kit-ai \
      @socialrobot-io/agent-kit-sessions @socialrobot-io/agent-kit-sandbox \
      @socialrobot-io/agent-kit-curator
```

| Package | Job |
| ------- | --- |
| [`…-core`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-core) | Agent definition, runtime, memory, skills, approval |
| [`…-ai`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-ai) | Call a live model (Vercel AI SDK) |
| [`…-sessions`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-sessions) | Save chats and search past ones for that tenant |
| [`…-sandbox`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-sandbox) | Tenant disk volume and guarded shell |
| [`…-curator`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-curator) | After a chat, propose memory and skill updates |

## Quick start

agent-kit does not host your app. You authenticate the user, map them to a
`tenantId`, open that tenant’s SQLite volume, then call the kit.

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession, resolveModel, runAgentTurn } from "@socialrobot-io/agent-kit-ai";
import { openAgentFs, serializeAgentFs, createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import { FileTranscriptStore, assertTenantSession, createSessionSearchTool } from "@socialrobot-io/agent-kit-sessions";

// From your auth layer. Do not trust a client-supplied tenantId.
const tenantId = "brand-123";
const sessionId = "chat-abc";

const afs = await openAgentFs(`/data/tenants/${tenantId}.db`);
serializeAgentFs(afs.fs);
// adaptAgentFs: ~20-line bridge from agentfs-sdk → agent-kit (paste from Hosting guide)
const fs = adaptAgentFs(afs.fs);

const transcripts = new FileTranscriptStore({ fs });
await transcripts.createSession({ id: sessionId, tenantId, source: "chat", createdAt: Date.now() / 1000 });
await assertTenantSession(transcripts, tenantId, sessionId);

const bash = await createTenantBashToolkit({ tenantId, agentFs: afs });
const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const search = createSessionSearchTool(transcripts, tenantId, { currentSessionId: sessionId });

const session = await openAgentSession({
  tenantId, fs, definition,
  sessionSearchTool: search,
  sandboxTools: bash.tools,
});

const { toolSet } = session.composeTools();
const turn = await runAgentTurn(
  [{ role: "user", content: "Summarize /workspace; prefer short answers going forward." }],
  { runtime: session.runtime, model: resolveModel(definition.model), toolSet },
);
```

What this does:

1. Opens one AgentFS volume for the tenant (memory, skills, workspace, chat logs).
2. Wraps that volume with `adaptAgentFs` so the kit can read and write it.
3. Binds `sessionId` to the tenant, then adds guarded bash + cross-session search.
4. Runs one model turn with the default tool surface.

Learning is a later step: the curator stages memory/skill proposals under
`pending/`; a human approves them; the **next** session snapshot picks them up.
Full walkthrough: [Host an agent in your app](docs/guides/hosting.md).
Approve flow: [Skills & learning](docs/guides/skills-and-learning.md).

### Example app

[`examples/example-app`](examples/example-app) is this stack as a streaming
Next.js chat (AI SDK UI `useChat`).

```bash
git clone git@github.com:socialrobot-io/agent-kit.git
cd agent-kit && bun install
cd examples/example-app
cp .env.sample .env.local   # set DEEPSEEK_API_KEY (or AI_GATEWAY_API_KEY)
npx nx dev example          # http://localhost:3000
```

### Offline demo

No API keys. Exercises approval, recall, and tenant isolation:

```bash
bun packages/cli/src/lib/demo.ts
```

---

## How it works

<div align="center">
<img src="docs/assets/architecture.svg" alt="Production agent stack: secure, sandboxed, self-improving" width="100%"/>
</div>

<br/>

1. **Author** the agent as markdown files: who it is (`SOUL.md`), house rules
   (`AGENTS.md`), optional skills and memories.
2. **Open a session** for one tenant. The system prompt is built once from
   those files plus a memory snapshot that does not change mid-chat.
3. **Guard** writes and shell commands. Bad content is scanned before it can
   enter a future prompt. Dangerous commands are blocked before they run.
4. **Curate** after the chat. A background pass may propose lasting memory or
   skills.
5. **Approve.** Proposals sit under `pending/` until a human accepts them.
6. **Recall.** The next chat sees approved memory. Past chats for that tenant
   are searchable; other tenants are not.

---

## Security

| Layer | Stops |
| ----- | ----- |
| **Threat scanning** | Injection and exfil patterns in memory/skills before they reach the prompt. Bad on-disk entries show as `[BLOCKED]`. |
| **Write approval** | Silent self-edits. Background and skill writes wait for a human. |
| **Sandbox** | Destructive shell, secret dumps, hosts you did not allow. |
| **Tenant isolation** | One volume and audit trail per tenant. Search never crosses tenants. |

Details: [Security guide](docs/guides/security.md).

---

## Docs

Read in order if you are integrating:

| Guide | Answers |
| ----- | ------- |
| [Getting started](docs/guides/getting-started.md) | Install, `agent/` files, first turn |
| [Hosting](docs/guides/hosting.md) | Auth, volume, session, approve in your app |
| [Tools](docs/guides/tools.md) | Defaults and how to add your own |
| [Models](docs/guides/models.md) | Pick a model, run or stream a turn |
| [Memory](docs/guides/memory.md) | What is remembered across chats |
| [Skills & learning](docs/guides/skills-and-learning.md) | Skills, curator, human approve |
| [Sandbox](docs/guides/sandbox.md) | Guarded shell and workspace |
| [Security](docs/guides/security.md) | Scans, approval, isolation |
| [Publishing](docs/guides/publishing.md) | npm release (maintainers) |

Not ready yet: [Multi-machine](docs/roadmap/multi-machine.md).

---

## Commands

```bash
bun install
bun packages/cli/src/lib/demo.ts     # offline production-loop demo
npx nx run-many -t test --all
npx nx run-many -t build --all
```

## License

MIT. See [`NOTICE`](NOTICE) for third-party attribution.

<div align="center">
<img src="docs/assets/logo.png" alt="agent-kit" width="72"/>
<br/>
<b>agent-kit</b>: agents you can ship.
</div>
