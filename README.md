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
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";
import { openTenantVolume, createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import { FileTranscriptStore, assertTenantSession, createSessionSearchTool } from "@socialrobot-io/agent-kit-sessions";

// Who owns this data? Map from your login system. Never take tenantId from the client body.
const tenantId = "brand-123";
// Which chat is this? One id per conversation in your UI / API.
const sessionId = "chat-abc";

// Open that tenant’s SQLite file. Memory, skills, workspace, and chat logs live here.
const volume = await openTenantVolume(`/data/tenants/${tenantId}.db`);

// Persist chat history on the same volume.
const transcripts = new FileTranscriptStore({ fs: volume });
// Register this conversation for the tenant.
await transcripts.createSession({ id: sessionId, tenantId, source: "chat", createdAt: Date.now() / 1000 });
// Fail closed if sessionId belongs to another tenant.
await assertTenantSession(transcripts, tenantId, sessionId);

// Guarded shell + workspace files under /workspace (same volume).
const bash = await createTenantBashToolkit({ tenantId, volume });
// Let the model search past chats for this tenant (not the current one).
const search = createSessionSearchTool(transcripts, tenantId, { currentSessionId: sessionId });

// Wire runtime + default tools (memory, skills, search, bash).
const session = await openAgentSession({
  tenantId,
  fs: volume, // same volume for memory / skills / transcripts
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }), // model id or LanguageModel
  sessionSearchTool: search,
  sandboxTools: bash.tools, // bash, readFile, writeFile
});

// One model turn to completion (use session.stream for useChat).
const turn = await session.run([
  { role: "user", content: "Summarize /workspace; prefer short answers going forward." },
]);
```

Learning is a later step: the curator stages memory/skill proposals under
`pending/`; a human approves them; the **next** session snapshot picks them up.
Full walkthrough: [Host an agent in your app](docs/guides/hosting.md).
Approve flow: [Skills & learning](docs/guides/skills-and-learning.md).

<details>
<summary><strong>Next.js App Router</strong> (auth cookie / JWT → tenant volume → stream)</summary>

Assumptions: you already have login (Auth.js, Clerk, custom JWT cookie, …).
On each request you resolve a **stable** `tenantId` from that session. The
client may send `sessionId` (chat id) and messages; it must **not** choose
`tenantId`.

```ts
// lib/auth.ts — your real auth; sketch only
import { cookies } from "next/headers";

export async function requireTenantId(): Promise<string> {
  // e.g. verify session cookie / JWT, load user, return user.orgId or user.id
  const token = (await cookies()).get("session")?.value;
  if (!token) throw new Error("unauthorized");
  const user = await verifySession(token); // your code
  return user.tenantId; // never from req.json()
}
```

```ts
// lib/agent-home.ts — one volume + toolkit per tenant per process
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";
import { openTenantVolume, createTenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import {
  FileTranscriptStore,
  assertTenantSession,
  createSessionSearchTool,
} from "@socialrobot-io/agent-kit-sessions";

const homes = new Map<string, Awaited<ReturnType<typeof openHome>>>();

async function openHome(tenantId: string) {
  const volume = await openTenantVolume(`./data/tenants/${tenantId}.db`);
  const transcripts = new FileTranscriptStore({ fs: volume });
  const bash = await createTenantBashToolkit({ tenantId, volume });
  return { volume, transcripts, bash };
}

export async function getTenantHome(tenantId: string) {
  let home = homes.get(tenantId);
  if (!home) {
    home = await openHome(tenantId);
    homes.set(tenantId, home);
  }
  return home;
}

export async function openChatSession(tenantId: string, sessionId: string) {
  const { volume, transcripts, bash } = await getTenantHome(tenantId);
  await transcripts.createSession({
    id: sessionId,
    tenantId,
    source: "chat",
    createdAt: Date.now() / 1000,
  });
  await assertTenantSession(transcripts, tenantId, sessionId);

  return openAgentSession({
    tenantId,
    fs: volume,
    definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
    sessionSearchTool: createSessionSearchTool(transcripts, tenantId, {
      currentSessionId: sessionId,
    }),
    sandboxTools: bash.tools,
  });
}
```

```ts
// app/api/chat/route.ts
import { convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream } from "ai";
import { requireTenantId } from "@/lib/auth";
import { getTenantHome, openChatSession } from "@/lib/agent-home";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const tenantId = await requireTenantId(); // 401/redirect inside if needed
  const { messages, id: sessionId } = await req.json();
  if (!sessionId) return Response.json({ error: "missing session id" }, { status: 400 });

  const session = await openChatSession(tenantId, sessionId);
  const { transcripts } = await getTenantHome(tenantId);
  const result = session.stream(await convertToModelMessages(messages), {
    maxSteps: 12,
    onFinish: async ({ text }) => {
      await transcripts.appendMessage({
        id: `asst_${Date.now()}`,
        sessionId,
        role: "assistant",
        content: text || "(no text)",
        createdAt: Date.now() / 1000,
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

Client: AI SDK UI `useChat({ id: sessionId })` so the same chat keeps one
frozen memory snapshot. Working reference:
[`examples/example-app`](examples/example-app).

</details>

<details>
<summary><strong>Hono / Express</strong> (middleware auth → tenant volume → JSON turn)</summary>

Same rules: auth middleware sets `tenantId`. Body carries `sessionId` +
`messages` only.

```ts
// auth middleware (Hono) — sketch; same idea for Express
import { createMiddleware } from "hono/factory";

export const requireAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("authorization"); // or cookie
  if (!header?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);
  const user = await verifyAccessToken(header.slice(7)); // your code
  c.set("tenantId", user.tenantId); // stable id from your user store
  await next();
});
```

```ts
// agent-home.ts — shared with the Next.js sketch (openTenantVolume, cache by tenantId)
// export getTenantHome / openChatSession as above
```

**Hono**

```ts
import { Hono } from "hono";
import { requireAuth } from "./auth";
import { openChatSession } from "./agent-home";

const app = new Hono();
app.use("/chat/*", requireAuth);

app.post("/chat", async (c) => {
  const tenantId = c.get("tenantId") as string;
  const { sessionId, messages } = await c.req.json();
  if (!sessionId || !messages?.length) {
    return c.json({ error: "sessionId and messages required" }, 400);
  }

  const session = await openChatSession(tenantId, sessionId);
  const turn = await session.run(messages);
  return c.json({ text: turn.text, toolCalls: turn.toolCalls });
});
```

**Express**

```ts
import express from "express";
import { openChatSession } from "./agent-home";

const app = express();
app.use(express.json());

async function requireAuth(req, res, next) {
  try {
    const user = await verifyAccessToken(req.headers.authorization); // your code
    req.tenantId = user.tenantId;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

app.post("/chat", requireAuth, async (req, res) => {
  const { sessionId, messages } = req.body ?? {};
  if (!sessionId || !messages?.length) {
    return res.status(400).json({ error: "sessionId and messages required" });
  }

  const session = await openChatSession(req.tenantId, sessionId);
  const turn = await session.run(messages);
  res.json({ text: turn.text, toolCalls: turn.toolCalls });
});
```

For streaming over HTTP, use `session.stream` and pipe the AI SDK UI message
stream the same way as the Next.js route. Volume path and process cache rules
are unchanged: [Hosting](docs/guides/hosting.md).

</details>

### Full example app

Runnable Next.js chat in this repo (AI SDK UI `useChat`):

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
