# Getting started

This guide gets packages installed, shows the agent file layout, and runs one
model turn in memory. For a real multi-tenant app (SQLite volume, sandbox,
transcripts), use [Host an agent in your app](hosting.md) next.

## 1. Install

```bash
npm i @socialrobot-io/agent-kit-core @socialrobot-io/agent-kit-ai \
      @socialrobot-io/agent-kit-sessions @socialrobot-io/agent-kit-sandbox \
      @socialrobot-io/agent-kit-curator
```

| Package | Job |
| ------- | --- |
| `agent-kit-core` | Agent definition, session runtime, memory, skills, approval |
| `agent-kit-ai` | Call a live model through the Vercel AI SDK |
| `agent-kit-sessions` | Save chat transcripts and search past chats |
| `agent-kit-sandbox` | Per-tenant disk volume and guarded shell |
| `agent-kit-curator` | After a chat, propose memory and skill updates |

## 2. Author the agent as files

The agent is a directory of markdown, not a big config object.

```text
agent/
  SOUL.md       who the agent is (always in the system prompt)
  AGENTS.md     house rules
  skills/       reusable how-to procedures (optional at first)
  memories/     USER.md and MEMORY.md (the agent writes these later)
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

## 3. Run one turn (in-memory, no SQLite)

This path needs an API key (`AI_GATEWAY_API_KEY`) or any AI SDK
`LanguageModel` you pass yourself. It uses an in-memory filesystem so you can
try without opening a tenant volume.

Do not use this path for multi-tenant production. Use [Hosting](hosting.md).

```ts
import { defineAgent, InMemoryFs } from "@socialrobot-io/agent-kit-core";
import { openAgentSession } from "@socialrobot-io/agent-kit-ai";

const fs = new InMemoryFs();
await fs.writeFile("agent/SOUL.md", "You are a concise research assistant.");
await fs.writeFile("agent/AGENTS.md", "Prefer short, factual answers.");

const session = await openAgentSession({
  tenantId: "brand-123",
  fs,
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});

const turn = await session.run([
  { role: "user", content: "Help me plan a product launch." },
]);
console.log(turn.text);
```

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

Put the same stack in your app with a real tenant volume:
[Host an agent in your app](hosting.md).
