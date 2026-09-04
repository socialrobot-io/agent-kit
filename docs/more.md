# More

Install details, how the loop works, the demo app, security, and contributor
commands. For the product pitch and copy-paste setup, see the
[root README](../README.md).

## Install

**Requirements**

- Node.js 20+ (or Bun)
- Durable local disk for per-tenant SQLite volumes (one machine today)
- A model provider for live turns

Happy path package (volume + transcripts + sandbox + live loop):

```bash
npm i @socialrobot-io/agent-kit-node ai
# Next.js apps also: npm i @socialrobot-io/agent-kit-next
# also pulls core, agent-kit-ai, sessions, sandbox, curator
# `ai` is a peer (Vercel AI SDK); install it next to the kit
```

| Package | Job |
| ------- | --- |
| [`@socialrobot-io/agent-kit-node`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-node) | `createTenantHome` (volume, sandbox, sessions, curator) |
| [`@socialrobot-io/agent-kit-next`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-next) | `withAgentKit` Next.js config helper |
| [`@socialrobot-io/agent-kit-core`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-core) | Definition, memory, skills, approval |
| [`@socialrobot-io/agent-kit-ai`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-ai) | `AgentSession.run` / `.stream` |
| [`@socialrobot-io/agent-kit-sessions`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-sessions) | Transcripts + `session_search` |
| [`@socialrobot-io/agent-kit-sandbox`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-sandbox) | Volume + guarded bash |
| [`@socialrobot-io/agent-kit-curator`](https://www.npmjs.com/package/@socialrobot-io/agent-kit-curator) | Background review (wired by `agent-kit-node`) |

**Package manager notes**

- **Bun**: Bun blocks lifecycle scripts by default. Trust `@mongodb-js/zstd`
  so its `prebuild-install` can fetch a binary:

  ```json
  {
    "trustedDependencies": ["@mongodb-js/zstd"]
  }
  ```

  Then reinstall (`bun install`), or run `bun pm trust @mongodb-js/zstd`.
  Do not trust `node-liblzma` unless your machine can compile it
  (`pkg-config` + system `liblzma`). A failed trusted install can delete the
  optional package under Bun.
- **npm**: `Cannot find native binding` outside a bundler means a missing
  platform package (known npm bug [npm/cli#4828](https://github.com/npm/cli/issues/4828)).
  Remove `node_modules` and `package-lock.json`, then install again.
- **Next.js / Turbopack**: use `withAgentKit` from
  `@socialrobot-io/agent-kit-next` ([Hosting](guides/hosting.md#nextjs-app-router)).

Full notes: [Getting started](guides/getting-started.md#package-manager-notes).

**Model provider**

Pass a ready `LanguageModel` from any [AI SDK provider](https://sdk.vercel.ai/providers)
(`@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/deepseek`, …). That is the
usual path.

```ts
import { anthropic } from "@ai-sdk/anthropic";

const home = await createTenantHome({
  tenantId: "brand-123",
  agent,
  model: anthropic("claude-sonnet-4-5"),
});
```

Or pass a `"provider/model"` string and set `AI_GATEWAY_API_KEY` so the
[Vercel AI Gateway](https://vercel.com/ai-gateway) resolves it.

## How it works

<div align="center">
<img src="assets/architecture.svg" alt="The agent loop: open, guard, curate, approve, recall on a per-tenant AgentFS volume" width="100%"/>
</div>

<br/>

Write the agent once as files: identity (`SOUL.md`), rules (`AGENTS.md`), and
optional skills or memories. Then the session loop is:

1. **Open.** Start a session for one tenant. Load or compile the agent so those
   files seed the tenant volume. The runtime builds the system prompt once from
   identity, rules, skills, and a frozen memory snapshot. Memory does not change
   mid-chat.
2. **Guard.** Scan content before it can enter memory or skills. Block dangerous
   shell commands before they run.
3. **Curate.** After each turn, `createTenantHome` can propose durable memory or
   skills in the background. Set `config.curator: false` to turn this off.
4. **Approve.** Proposals stay under `pending/` until a human accepts them, or
   apply immediately when `config.curator.autoApprove` is true.
5. **Recall.** The next chat includes approved memory. Past chats for that
   tenant are searchable. Other tenants stay isolated.

Your app owns auth and `tenantId`. The kit owns isolation, scanning, the
sandbox, and the approval gate.

## Try it

| Example | What it shows |
| ------- | ------------- |
| [`examples/example-app`](../examples/example-app) | Streaming Next.js chat + `/code-runner` page with `js-exec` |

```bash
git clone https://github.com/socialrobot-io/agent-kit.git
cd agent-kit && bun install
cd examples/example-app
cp .env.sample .env.local   # set DEEPSEEK_API_KEY or AI_GATEWAY_API_KEY
npx nx dev example          # http://localhost:3000
# Code runner (js-exec): http://localhost:3000/code-runner
```

## Security

| Layer | Stops |
| ----- | ----- |
| **Threat scanning** | Injection and exfil patterns in memory/skills before they reach the prompt. Bad on-disk entries show as `[BLOCKED]`. |
| **Write approval** | Silent self-edits. Writes stage for review by default (or use `curator.autoApprove`). |
| **Sandbox** | Destructive shell, secret dumps, hosts you did not allow. |
| **Tenant isolation** | One volume and audit trail per tenant. Search never crosses tenants. |

Before you ship:

1. Resolve `tenantId` only from trusted auth. Use an opaque id safe for paths.
2. Pass `agent` so company identity and skills are installed on the volume.
3. Lock company-owned skills; unlocked skills stay mutable behind approval.
4. Pass sandbox `secrets` and hostname-only `allowedHosts` at home creation.
5. Do not hand tools the raw volume write handle.

Details: [Security guide](guides/security.md).

## Guides

| Guide | Answers |
| ----- | ------- |
| [Getting started](guides/getting-started.md) | Install, agent files, first turn |
| [Hosting](guides/hosting.md) | Auth, volume, session, Next.js |
| [Security](guides/security.md) | Scans, approval, isolation |
| [Tools](guides/tools.md) | Host tools vs sandbox vs skills |
| [Sandbox](guides/sandbox.md) | Curl, `js-exec`, `python3`, custom bash cmds |
| [Models](guides/models.md) | Pick a model, run or stream a turn |
| [Memory](guides/memory.md) | What is remembered across chats |
| [Skills & learning](guides/skills-and-learning.md) | Skills, curator, human approve |
| [Publishing](guides/publishing.md) | npm release (maintainers) |

Not ready yet: [Multi-machine](roadmap/multi-machine.md).

Full index: [docs/README](README.md).

## Commands (contributors)

```bash
bun install
npx nx run-many -t test --all
npx nx run-many -t build --all
```

Before a commit: `npx nx run-many -t typecheck test build --all` must be green.
