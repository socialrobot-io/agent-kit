# agent-kit

A TypeScript toolkit for building **self-improving AI agents**: agents that
persist curated memory, distill reusable skills from their own sessions, and
run safely in a per-tenant sandbox.

It ports the memory/skill/curator primitives from
[Nous Research Hermes Agent](https://github.com/NousResearch/hermes-agent)
(MIT) into a composable library, and pairs them with an
[AgentFS](https://www.agentfs.ai/)-backed execution sandbox and a
[bash-tool](https://github.com/vercel-labs/bash-tool) `Sandbox` backend.
See `NOTICE` for attribution and `vendor/hermes/` for the pinned upstream
sources these were ported from.

## Packages

| Package | What it provides |
| ------- | ---------------- |
| `@agent-kit/core` | `defineAgent`, `agent/` discovery (SOUL.md, AGENTS.md, skills/), the `MemoryStore` (MEMORY.md/USER.md with frozen system-prompt snapshots), `SkillLibrary` (progressive-disclosure skills), the write-approval gate + `PendingWriteStore`, threat scanning, the Hermes tool schemas, and the `AgentSessionRuntime` composition root. |
| `@agent-kit/sandbox` | Per-tenant `TenantAgentFSSandbox` (a bash-tool `Sandbox`), command guardrails (destructive / exfil / network-egress), and an append-only sandbox audit store. |
| `@agent-kit/sessions` | A pluggable cross-session transcript store + `session_search` (full-text recall). In-memory adapter for dev/tests; a Postgres (tsvector) adapter plugs into a SaaS. |
| `@agent-kit/curator` | The background self-improvement reviewer: Hermes review prompts, a restricted `memory` + `skill_manage` toolset, and routing of every write through the approval gate. |
| `@agent-kit/cli` | `agent-kit demo` — an end-to-end scripted run that proves the flywheel (session → curate → approve → recall → tenant isolation). |

## The self-improvement loop

1. **Author** an agent as a directory (`agent/SOUL.md`, `agent/AGENTS.md`,
   `agent/skills/`, `agent/memories/`), Eve-style, via `defineAgent`.
2. **Run a session.** The system prompt = SOUL + AGENTS.md + a **frozen
   snapshot** of MEMORY.md/USER.md (so the prefix cache stays stable
   mid-session). The model can call `memory`, `skills_list`, `skill_view`,
   `skill_manage`, `session_search`.
3. **Curate.** After a turn, the background curator reviews the transcript with
   a *restricted* toolset and distills durable user facts (→ memory) and
   reusable procedures (→ skills).
4. **Approve.** Writes are staged to `pending/{memory,skills}/` when
   `write_approval` is on, and replayed on approval.
5. **Recall.** The next session's frozen snapshot contains the distilled
   memory; `skills_list` surfaces the new skill; `session_search` recalls prior
   sessions.

## Security model (defense in depth)

- **Threat scanning** (`@agent-kit/core/threats`): prompt-injection,
  promptware/C2, and exfiltration patterns are scanned before content enters
  the system prompt (memory writes, skill installs, on-disk memory at snapshot
  build).
- **Write approval** (`write_approval` gate): background/autonomous writes are
  always staged for human review; skills always stage when the gate is on.
- **Sandbox guardrails** (`@agent-kit/sandbox/guardrails`): destructive,
  exfiltration, and non-allowlisted network commands are blocked before
  execution; secrets are redacted.
- **Per-tenant AgentFS volumes**: each tenant's files live in an isolated
  SQLite volume (snapshots, rollback, audit). A bug cannot cross tenants.
- **Append-only audit**: every sandbox command / file op emits a record with
  files touched + snapshot id.

## Quick start

```bash
bun install
bun packages/cli/src/lib/demo.ts     # run the flywheel demo
npx nx run-many -t test --all        # run all tests
npx nx run-many -t build --all       # build all packages
```

Use the runtime in your own loop (swap the scripted model for a real LLM via
the Vercel AI SDK):

```ts
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";

const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",
  fs, // tenant's AgentFS volume adapter
  definition: defineAgent({ model: "anthropic/claude-sonnet-4-5" }),
});
await runtime.init();
const system = runtime.systemPrompt(); // frozen snapshot
const tools = runtime.tools();         // memory, skills_list, skill_view, skill_manage
// → hand `system` + `tools` to streamText / generate.
```

## License

MIT (this repo). Hermes Agent is MIT © Nous Research — see `NOTICE` and
`vendor/hermes/LICENSE`.
