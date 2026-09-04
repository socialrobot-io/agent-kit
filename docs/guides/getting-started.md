# Getting started

This guide gets packages installed, shows the agent file layout, and runs one
model turn. For production wiring (auth, company envelope seed, volume,
sandbox, transcripts), use [Host an agent in your app](hosting.md).

## 1. Install

Happy path:

```bash
npm i @socialrobot-io/agent-kit-node ai
```

That pulls core, agent-kit-ai, sessions, sandbox, and curator. Install `ai`
(the Vercel AI SDK) next to the kit: it is a peer of `agent-kit-ai` and
`agent-kit-node`.

| Package | Job |
| ------- | --- |
| `agent-kit-node` | `createTenantHome` (volume + transcripts + sandbox + session + curator) |
| `agent-kit-next` | `withAgentKit` Next.js config helper (optional) |
| `agent-kit-core` | Definition, memory, skills, approval |
| `agent-kit-ai` | Live model loop (`session.run` / `session.stream`) |
| `agent-kit-sessions` | Transcripts + `session_search` |
| `agent-kit-sandbox` | Per-tenant volume and guarded shell |
| `agent-kit-curator` | Background review (wired by `agent-kit-node`) |

### Package manager notes

- **Bun**: Bun blocks lifecycle scripts by default. Trust `@mongodb-js/zstd`
  (optional `just-bash` helper) so `prebuild-install` can fetch its binary:

  ```json
  {
    "trustedDependencies": ["@mongodb-js/zstd"]
  }
  ```

  Then install again, or run `bun pm trust @mongodb-js/zstd`. Without that
  binary, archive commands that need zstd can fail when the agent calls them.

  `node-liblzma` (xz) is different: its install script compiles from source
  with `node-gyp`. Trust it only when the host has `pkg-config` and system
  `liblzma`. If the trusted install fails, Bun can delete the optional
  package and leave a broken symlink under `just-bash`. Leave it untrusted
  unless you need xz and can build it.
- **npm**: if `AgentFS.open` fails with `Cannot find native binding` outside a
  bundler, the platform optional dependency is missing. This is a known npm
  bug with optional dependencies
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)). Remove
  `node_modules` and `package-lock.json`, then install again.
- **Next.js / Turbopack**: native packages must stay outside the bundle. See
  [Next.js (App Router)](hosting.md#nextjs-app-router).

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

Pass a `LanguageModel` from any AI SDK provider, or set `AI_GATEWAY_API_KEY`
and use a `"provider/model"` string. Creates `./data/tenants/${tenantId}.db`
by default.

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
import { anthropic } from "@ai-sdk/anthropic";
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent";

const home = await createTenantHome({
  tenantId: "brand-123",
  agent,
  model: anthropic("claude-sonnet-4-5"),
});
const session = await home.openSession("chat-1");

const turn = await session.run([
  { role: "user", content: "Help me plan a product launch." },
]);
console.log(turn.text);
```

Plain Node with agent folders on disk can use `loadAgent("chat")` (opens
`agents/chat` under the app root). Set `AGENT_KIT_AGENTS_DIR` if the folder
is not `agents/`.

For a real app, prefer `createAgentKit` (one object, cached homes + sessions):
see [Hosting](hosting.md#happy-path).

For a throwaway in-memory filesystem (no SQLite), use `openAgentSession` with
`InMemoryFs` from `@socialrobot-io/agent-kit-core`. Do not use that path for
multi-tenant production. See [Hosting](hosting.md).

## 4. What happens after each turn

With `createTenantHome`, a background **curator** runs after every turn
(default on). It may stage memory or skill updates under `pending/`. They are
not live until a human approves them, unless you set
`config.curator: { autoApprove: true }`. The **next** chat session sees
approved content. Disable with `defineAgent({ config: { curator: false } })`.

Details: [Skills & learning](skills-and-learning.md).

## Next

Put the same stack in your app with auth and a stable tenant id:
[Host an agent in your app](hosting.md).

Or run the example chat app: [`examples/example-app`](../../examples/example-app).
