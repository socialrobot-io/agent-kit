<div align="center">

<img src="docs/assets/hero.jpg" alt="agent-kit: self-improving AI agents" width="100%"/>

<br/>

### Production-grade agents.<br/>Secure. Sandboxed. Self-improving.

A TypeScript toolkit for shipping AI agents that are multi-tenant-safe, without complex infrastructure.
Curated memory, human-gated learning, and a real execution sandbox.

[![npm](https://img.shields.io/npm/v/%40socialrobot-io%2Fagent-kit-core.svg)](https://www.npmjs.com/package/@socialrobot-io/agent-kit-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-7C5CFF.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Nx](https://img.shields.io/badge/Nx-monorepo-143055.svg)](https://nx.dev)
[![Bun](https://img.shields.io/badge/Bun-runtime-F9F1E1.svg)](https://bun.sh)

[Why](#why) · [Set up](#set-up) · [Built on](#built-on) · [More](docs/more.md)

</div>

---

## Example

<img src="docs/assets/agent-kit.gif" alt="agent-kit"/>

## Why

Most agent harnesses are built for local use: one developer, one machine, one
trust boundary. Shipping agents into production is different. One mistake can
delete files, leak secrets, or cross tenant boundaries.

You stay in control of auth, tenancy, and the tools the agent can reach. Your users
get a real agent that can run code and improve over time, inside an isolated home.

No huge cloud bill. No fancy infrastructure.

| Pillar | What you get |
| ------ | ------------ |
| **Secure by default** | Prompt-injection, promptware, and exfiltration scanning on every memory and skill write. Threats never reach the system prompt. |
| **Sandboxed execution** | Per-tenant [AgentFS](https://www.agentfs.ai/) volumes and [bash-tool](https://github.com/vercel-labs/bash-tool) guardrails. Destructive commands, secret exfil, and non-allowlisted network egress are blocked before they run. |
| **Production multi-tenancy** | One isolated filesystem, memory, skill library, transcript store, and audit trail per tenant. A bug in tenant A cannot touch tenant B. |
| **Self-improving under approval** | A background curator distills sessions into durable memory and reusable skills. Writes stage for human review by default. Hosts can set `curator.autoApprove` when end users are not the right reviewers. |

---

## Set up

Your app authenticates the user and maps them to a stable `tenantId`. Never
take `tenantId` from the client body alone.

### 1. Install

```bash
npm i @socialrobot-io/agent-kit-node @socialrobot-io/agent-kit-next ai
npm i @ai-sdk/anthropic   # or openai / deepseek / …
```

Hono / Express: omit `@socialrobot-io/agent-kit-next`.

### 2. Next.js

**Config** — `agents/` next to `app/` by default. Custom folder:
`withAgentKit(config, { agentsDir: "src/agents" })`.

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withAgentKit } from "@socialrobot-io/agent-kit-next";

export default withAgentKit({} satisfies NextConfig);
```

**Agents** — one folder per agent. What goes in `SOUL.md` / `AGENTS.md`:
[Getting started](docs/guides/getting-started.md#2-author-the-agent-as-files).

```text
agents/
  chat/
    SOUL.md
    AGENTS.md
    skills/          optional
```

**Backend** — `createAgentKit` once at module scope. It owns the per-tenant
home cache and opens a fresh session per request (state lives on disk), so the
route just calls `kit.session(tenantId, sessionId)`.

```ts
// lib/kit.ts
import { anthropic } from "@ai-sdk/anthropic";
import { createAgentKit, loadAgent } from "@socialrobot-io/agent-kit-node";

export const kit = createAgentKit({
  agent: await loadAgent("chat"),
  model: anthropic("claude-sonnet-4-5"),
});
```

```ts
// app/api/chat/route.ts
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { requireUser } from "@/lib/auth";
import { kit } from "@/lib/kit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { tenantId } = await requireUser(req);
  const { messages, id: sessionId } = (await req.json()) as {
    messages: UIMessage[];
    id: string; // useChat
  };

  const session = await kit.session(tenantId, sessionId);
  const result = session.stream(await convertToModelMessages(messages));
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

Working demo: [`examples/example-app`](examples/example-app).

### 3. Hono / Express

Same `agents/` layout and `kit` as above.

```ts
// src/server.ts
import { Hono } from "hono";
import { requireUser } from "./auth";
import { kit } from "./kit";

const app = new Hono();

app.post("/chat", async (c) => {
  const { tenantId } = await requireUser(c);
  const { sessionId, text } = await c.req.json<{
    sessionId: string;
    text: string;
  }>();

  const session = await kit.session(tenantId, sessionId);
  const turn = await session.run([{ role: "user", content: text }]);
  return c.json({ text: turn.text });
});

export default app;
```

---

## Built on

agent-kit composes existing libraries. The [Vercel AI SDK](https://sdk.vercel.ai/)
shapes most of the live API (`ModelMessage`, `session.run` / `session.stream`,
`toolApproval`, and AI SDK UI `useChat`).

| Layer | Library | What you feel in the API |
| ----- | ------- | ------------------------ |
| Model loop | [`ai`](https://www.npmjs.com/package/ai) (Vercel AI SDK) | Messages, `run` / `stream`, tools, UI approval |
| Model providers | [AI SDK providers](https://sdk.vercel.ai/providers) or [`@ai-sdk/gateway`](https://www.npmjs.com/package/@ai-sdk/gateway) | Pass a `LanguageModel`, or a string id via the Gateway |
| Tenant volume | [AgentFS](https://www.agentfs.ai/) | One SQLite filesystem per tenant |
| Sandbox shell | [bash-tool](https://github.com/vercel-labs/bash-tool) + [just-bash](https://github.com/vercel-labs/just-bash) | `bash` / `readFile` / `writeFile` behind guardrails |

If you already use the AI SDK, agent-kit slots in as the tenant home, memory,
skills, and sandbox around that loop.

---

[More](docs/more.md): install notes, how the loop works, demo commands, security,
and all guides.

MIT. See [`NOTICE`](NOTICE) for third-party attribution.
