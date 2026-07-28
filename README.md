<div align="center">

<img src="docs/assets/hero.png" alt="agent-kit — self-improving AI agents" width="100%"/>

<br/>

### Production-grade agents.<br/>Secure. Sandboxed. Self-improving.

A TypeScript toolkit for shipping AI agents that are safe enough for multi-tenant SaaS —
with curated memory, human-gated learning, and a real execution sandbox.

[![License: MIT](https://img.shields.io/badge/License-MIT-7C5CFF.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org/)
[![Nx](https://img.shields.io/badge/Nx-monorepo-143055.svg)](https://nx.dev)
[![Bun](https://img.shields.io/badge/Bun-runtime-F9F1E1.svg)](https://bun.sh)
[![Tests](https://img.shields.io/badge/tests-73%20passing-22D3EE.svg)](#)

[Why](#the-moat) · [Quick start](#quick-start) · [How it works](#how-it-works) · [Security](#security) · [Docs](docs/)

</div>

---

## The moat

Most agent frameworks optimize for demos. agent-kit optimizes for **shipping agents
into production** — where a single mistake can delete files, leak secrets, or cross
tenant boundaries.

| Pillar | What you get |
| ------ | ------------ |
| **Secure by default** | Prompt-injection / promptware / exfiltration scanning on every memory and skill write. Threats never reach the system prompt. |
| **Sandboxed execution** | Per-tenant [AgentFS](https://www.agentfs.ai/) volumes + [bash-tool](https://github.com/vercel-labs/bash-tool) guardrails. Destructive commands, secret exfil, and non-allowlisted network egress are blocked before they run. |
| **Production multi-tenancy** | One isolated filesystem, memory, skill library, transcript store, and audit trail per tenant. A bug in tenant A cannot touch tenant B. |
| **Self-improving under approval** | A background curator distills sessions into durable memory and reusable skills — staged for human review, never applied silently. |

Learning without a sandbox is a liability. A sandbox without learning is just a
cage. agent-kit is both.

It's a **library**, not a hosted service. Author an agent as a directory, hand
the runtime a per-tenant filesystem, and the production stack comes with it.

---

## Quick start

```bash
git clone git@github.com:ntgussoni/agent-kit.git
cd agent-kit
bun install

# Watch the full production loop (no API keys needed)
bun packages/cli/src/lib/demo.ts
```

```text
=== Session 1 (tenant A) ===        ✓ snapshot has no memory yet
=== Curator review (background) ===  ✓ staged memory + skill, nothing applied
=== Approve staged writes ===        ✓ human reviews, then applies
=== Session 2 (tenant A) — recall ===✓ snapshot recalls memory, sees new skill
=== Cross-session FTS recall ===     ✓ session_search finds session 1
=== Tenant B — isolation ===         ✓ own empty memory / skills / FTS

DEMO PASSED
```

### Run it against a real model

`@agent-kit/ai` resolves `defineAgent({ model })` into a live model and runs the
loop for you, via the [Vercel AI SDK](https://sdk.vercel.ai). One API key
(`AI_GATEWAY_API_KEY`) reaches every provider through the AI Gateway.

```ts
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";
import { runAgentTurn } from "@agent-kit/ai";

const definition = defineAgent({ model: "anthropic/claude-sonnet-4-5" });
const runtime = new AgentSessionRuntime({
  tenantId: "brand-123",            // one isolated agent home per tenant
  fs,                               // that tenant's AgentFS volume
  definition,
});
await runtime.init();

const turn = await runAgentTurn(
  [{ role: "user", content: "Stop being so verbose." }],
  { runtime, definition },
);
// turn.text — the model's reply; it called `memory` to save the preference.
```

**Models:** any AI SDK provider — OpenAI, Anthropic, Google, Mistral, Groq,
OpenRouter, Azure, Bedrock, or your own gateway. Pass a `"provider/model"`
string (resolved through the AI Gateway) or a ready `LanguageModel` instance.
The demo runs on an offline mock so it works with zero keys; `runAgentTurn` is
the same code path pointed at a live model.

### Example app

[`examples/example-app`](examples/example-app) is a streaming Next.js chat over
agent-kit (AI SDK UI `useChat`), with persistent AgentFS memory, bash-tool
sandbox tools, and a live model.

```bash
cd examples/example-app
cp .env.sample .env.local   # set DEEPSEEK_API_KEY (or AI_GATEWAY_API_KEY)
npx nx dev example          # http://localhost:3000
```

Defaults to `@ai-sdk/deepseek` + `deepseek-v4-flash`. Gateway is the fallback.

---

## How it works

<div align="center">
<img src="docs/assets/architecture.svg" alt="Production agent stack — secure, sandboxed, self-improving" width="100%"/>
</div>

<br/>

**1. Author** an agent as a directory (Eve-style): `SOUL.md` for identity,
`AGENTS.md` for house rules, `skills/` for procedures, `memories/` for curated
facts.

**2. Run** a session. The system prompt is built once — SOUL + AGENTS.md + a
**frozen** memory snapshot — so your provider's prefix cache stays hot. The
model gets a small, proven tool surface.

**3. Guard** every write and every command. Content is threat-scanned before it
can enter the prompt. Shell commands hit guardrails before they execute. Every
action lands in an append-only audit log with snapshot ids.

**4. Curate** after the turn. A background reviewer with a *restricted* toolset
proposes durable memory and reusable skills.

**5. Approve.** Nothing autonomous becomes permanent. Writes stage to
`pending/` and replay only on human approval.

**6. Recall.** The next session's snapshot includes what was approved. Prior
sessions are searchable via full-text recall — scoped to that tenant only.

---

## Security

Four walls, not one:

| Layer | Stops |
| ----- | ----- |
| **Threat scanning** | Prompt injection, promptware/C2, credential exfil patterns, invisible unicode — scanned before content reaches the system prompt. Poisoned on-disk entries render as `[BLOCKED]` in the snapshot. |
| **Write approval** | Silent self-modification. Background and skill writes always stage for review. |
| **Sandbox guardrails** | `rm -rf /`, fork bombs, `curl $SECRET`, `cat .env`, non-allowlisted hosts. Secrets are redacted from the command line. |
| **Tenant isolation** | Per-tenant AgentFS volume + audit trail. Snapshots for rollback. Cross-tenant FTS returns nothing. |

This is the difference between an agent you demo and an agent you put behind a
paying customer.

---

## What you get

| Capability | Description |
| ---------- | ----------- |
| **Curated memory** | Bounded `MEMORY.md` / `USER.md` with char budgets, consolidation guidance, and frozen system-prompt snapshots |
| **Progressive skills** | `agentskills.io`-style procedures: list → view → drill into references/templates/scripts |
| **Background curator** | Distills sessions into memory + skills with Hermes-proven review prompts |
| **Human approval gate** | Stage → review → replay. No silent writes from autonomous processes |
| **Per-tenant sandbox** | AgentFS volumes + bash-tool backend + command guardrails + audit |
| **Cross-session recall** | Full-text `session_search` scoped per tenant |
| **Eve-like authoring** | `defineAgent` + an `agent/` directory — SOUL, AGENTS, skills, memories |
| **Live model loop** | `@agent-kit/ai` resolves `defineAgent({ model })` and runs tools to completion via the Vercel AI SDK |

Primitives are ported from [Nous Research Hermes](https://github.com/NousResearch/hermes-agent)
(MIT) and composed for multi-tenant production use. See [`NOTICE`](NOTICE).

---

## Docs

| Guide | For |
| ----- | --- |
| [Getting started](docs/guides/getting-started.md) | Install, first agent, first session |
| [Models & the loop](docs/guides/models.md) | `defineAgent({ model })` → a live AI SDK model |
| [Security & isolation](docs/guides/security.md) | Threat scan, approval, sandbox, tenants |
| [Memory](docs/guides/memory.md) | What the agent remembers, and why it's cheap |
| [Skills & learning](docs/guides/skills-and-learning.md) | How skills work and how the curator teaches |
| [Sandbox](docs/guides/sandbox.md) | Safe execution, guardrails, audit |

---

## Commands

```bash
bun install
bun packages/cli/src/lib/demo.ts     # production-loop demo
npx nx run-many -t test --all        # 80 tests
npx nx run-many -t build --all
```

## Models

`@agent-kit/ai` is the bridge to a live model. It exports:

- `resolveModel(model)` — a `"provider/model"` string → AI Gateway
  `LanguageModel`, or pass a ready `LanguageModel` straight through.
- `toAiTools(tools)` — adapt the runtime's Hermes tools into an AI SDK `ToolSet`.
- `runAgentTurn(messages, { runtime, model | definition })` — run one turn to
  completion (`generateText` + `stopWhen`), collecting tool calls.
- `aiCuratorRunner(model)` — a `CuratorModelRunner` on a live model, so the
  background curator reviews real transcripts with a real model.

Works with AI SDK **v7** (`ai` + `@ai-sdk/gateway`). The offline mock in the
demo and tests uses the same `LanguageModel` interface, so the live path is
identical.

## License

MIT. Hermes Agent primitives are MIT © Nous Research —
see [`NOTICE`](NOTICE) and [`vendor/hermes/LICENSE`](vendor/hermes/LICENSE).

<div align="center">
<img src="docs/assets/logo.png" alt="agent-kit" width="72"/>
<br/>
<b>agent-kit</b> — agents you can actually ship.
</div>
