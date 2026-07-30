# Getting started

This guide gets packages installed, shows the agent file layout, and runs one
model turn. For production wiring (auth, company envelope seed, volume,
sandbox, transcripts), use [Host an agent in your app](hosting.md).

## 1. Install

Happy path:

```bash
npm i @socialrobot-io/agent-kit-node
```

That pulls core, ai, sessions, and sandbox. Add
`@socialrobot-io/agent-kit-curator` when you want background learning.

| Package | Job |
| ------- | --- |
| `agent-kit-node` | `createTenantHome` (volume + transcripts + sandbox + session) |
| `agent-kit-core` | Definition, memory, skills, approval |
| `agent-kit-ai` | Live model loop (`session.run` / `session.stream`) |
| `agent-kit-sessions` | Transcripts + `session_search` |
| `agent-kit-sandbox` | Per-tenant volume and guarded shell |
| `agent-kit-curator` | After a chat, propose memory and skill updates |

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

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";

const home = await createTenantHome({ tenantId: "brand-123" });
const session = await home.openSession("chat-1");

const turn = await session.run([
  { role: "user", content: "Help me plan a product launch." },
]);
console.log(turn.text);
```

For a throwaway in-memory filesystem (no SQLite), use `openAgentSession` with
`InMemoryFs` from `@socialrobot-io/agent-kit-core`. Do not use that path for
multi-tenant production. See [Hosting](hosting.md).

## 4. What happens after a real session

A chat turn alone does not make lasting memory. In production:

1. A background **curator** reads the transcript and may propose updates.
2. Proposals land under `pending/` on the tenant volume. They are not live yet.
3. A human approves or rejects them.
4. The **next** chat session sees approved content.

Details: [Skills & learning](skills-and-learning.md).

## Try without an API key

Clone the repo and run the offline demo. It walks session → curator → approve
→ recall, and shows that tenant B cannot see tenant A’s data.

```bash
git clone git@github.com:socialrobot-io/agent-kit.git
cd agent-kit
bun install
bun packages/cli/src/lib/demo.ts
```

## Next

Put the same stack in your app with auth and a stable tenant id:
[Host an agent in your app](hosting.md).
