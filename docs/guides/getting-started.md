# Getting started

This guide gets packages installed, shows the agent file layout, and runs one
model turn. For production wiring (auth, company envelope seed, volume,
sandbox, transcripts), use [Host an agent in your app](hosting.md).

## 1. Install

Happy path:

```bash
npm i @socialrobot-io/agent-kit-node
```

That pulls core, ai, sessions, sandbox, and curator.

| Package | Job |
| ------- | --- |
| `agent-kit-node` | `createTenantHome` (volume + transcripts + sandbox + session + curator) |
| `agent-kit-core` | Definition, memory, skills, approval |
| `agent-kit-ai` | Live model loop (`session.run` / `session.stream`) |
| `agent-kit-sessions` | Transcripts + `session_search` |
| `agent-kit-sandbox` | Per-tenant volume and guarded shell |
| `agent-kit-curator` | Background review (wired by `agent-kit-node`) |

## 2. Author the agent as files

The agent is a directory of markdown, not a big config object. Company identity
(`SOUL.md`, `AGENTS.md`, locked skills) is seeded onto the volume; the agent
cannot rewrite those paths once the envelope is sealed. See [Security](security.md).

```text
agent/
  SOUL.md       who the agent is (always in the system prompt; company-sealed)
  AGENTS.md     house rules (company-sealed)
  skills/       reusable how-to procedures (optional; some may be locked)
  memories/     USER.md and MEMORY.md (tenant-curated, behind approval)
```

Example `SOUL.md`:

```md
You are a concise research assistant for a fintech startup.
```

Example `AGENTS.md`:

```md
Prefer short, factual answers.
Cite a source for every non-obvious claim.
Never invent numbers.
```

## 3. Run one turn (tenant home)

Needs an API key (`AI_GATEWAY_API_KEY`) or a `LanguageModel` you pass yourself.
Creates `./data/tenants/${tenantId}.db` by default.

Pass `agent` so `SOUL.md`, `AGENTS.md`, and skills are installed on the volume.
Without it, the session does not use your authored files.

Happy path: compile `agent/` in predev / CI, then import the module (same as
Next, Docker, and [`examples/example-app`](../../examples/example-app)):

```ts
// scripts/compile-agent.mjs
import { compileAgent } from "@socialrobot-io/agent-kit-node";
await compileAgent({ dir: "./agent", outFile: "./src/generated/agent.ts" });
```

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({ tenantId: "brand-123", agent });
const session = await home.openSession("chat-1");

const turn = await session.run([
  { role: "user", content: "Help me plan a product launch." },
]);
console.log(turn.text);
```

Plain Node with `agent/` on disk can use `loadAgent("./agent")` instead of
compile + import.

For a throwaway in-memory filesystem (no SQLite), use `openAgentSession` with
`InMemoryFs` from `@socialrobot-io/agent-kit-core`. Do not use that path for
multi-tenant production. See [Hosting](hosting.md).

## 4. What happens after each turn

With `createTenantHome`, a background **curator** runs after every turn
(default on). It may stage memory or skill updates under `pending/`. They are
not live until a human approves them. The **next** chat session sees approved
content. Disable with `defineAgent({ config: { curator: false } })`.

Details: [Skills & learning](skills-and-learning.md).

## Next

Put the same stack in your app with auth and a stable tenant id:
[Host an agent in your app](hosting.md).

Or run the example chat app: [`examples/example-app`](../../examples/example-app).
