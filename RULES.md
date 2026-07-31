# RULES.md (root)

These rules define what agent-kit is, how we build in it, and what every change
must take into consideration. Package-level rules live in `packages/*/RULES.md`
and `examples/RULES.md`; the nearest file wins when they overlap.

## The idea

1. **Generic primitives, reusable anywhere.** This repo is a toolkit, not a
   product and not a service. Nothing tenant-, brand-, or product-specific
   (SocialRobot, DeepSeek defaults, business flows) belongs in `packages/`.
   Specialization happens in consumer apps on top of the toolkit.
2. **Agents are files.** An agent is authored as a directory (`SOUL.md`,
   `AGENTS.md`, `skills/`) and its learned state is files in an AgentFS volume
   (`memories/MEMORY.md`, `memories/USER.md`, `skills/`, `pending/`). Code reads and
   writes files; there is no hidden database of agent state.
3. **The learning loop is explicit.** Session transcripts feed a background
   curator; the curator proposes memory and skill writes; a human (or
   `config.curator.autoApprove`) applies them; the next session's frozen system
   prompt reflects them. Every arrow in that loop is inspectable and testable.
4. **Multi-tenancy by construction.** Isolation comes from one AgentFS volume
   per tenant plus tenant-scoped transcript/audit stores, not from filters
   sprinkled on shared state.
5. **Execution is safe by default.** bash goes through guardrails, runs against
   a per-tenant AgentFS volume, and is audited. Untrusted content is
   threat-scanned. Writes behind approval stay staged until approved.

## Architecture invariants

- Dependency direction (never introduce a cycle):
  - Leaves (no `@socialrobot-io/agent-kit-*` deps): `core`, `sessions`, `sandbox`.
  - `curator` and `ai` may depend on `core` only.
  - `node` is the host composition package (`createTenantHome`); it may depend
    on `core`, `ai`, `sessions`, and `sandbox`. Never add `node` as a dep of a leaf.
  - `cli` and `examples/*` are top-level consumers and may depend on anything.
- `vendor/hermes` is a pinned, read-only upstream snapshot (see
  `vendor/hermes/UPSTREAM_COMMIT`). Never edit it; port deliberately into
  `packages/core` and note parity decisions in the port.
- Public API surface is each package's `src/index.ts`. If it is not exported
  there, it is internal.

## How we implement

- Strict TypeScript, ESM, NodeNext resolution. No `any` unless unavoidable;
  cast through `unknown` and say why in a comment.
- Source and tests are colocated in `src/lib/` as `name.ts` + `name.spec.ts`
  (vitest). Spec imports use relative `./name.js` paths.
- Tests must pass offline: no network, no API keys, no real AgentFS volumes in
  unit tests (use `InMemoryFs` and mock models).
- Comments explain non-obvious intent, constraints, and ports (e.g. "mirrors
  vendor/hermes memory_tool.py"). Never narrate what the code plainly does.
- Prose in code, docs, and commit messages: no em dashes, no emojis.
- New packages are scaffolded with the Nx CLI (`npx nx g @nx/js:library`), then
  wire workspace deps by editing `package.json` (`"workspace:*"`) and running
  `bun install`. Do not `bun add --filter` workspace packages (it 404s).
- After adding or moving projects, run `npx nx sync` to refresh TS project
  references.

## What every change must consider

1. **Verification gate.** Before committing:
   `npx nx run-many -t typecheck test build --all` must be green, and every new
   module ships with tests. If you touched an example, its offline test must
   still pass without credentials.
2. **Security.** New inputs that can reach memory, skills, or prompts must be
   threat-scanned. New execution surfaces must be guardrailed and audited.
   Secrets are never committed; document new env vars in the nearest
   `.env.sample` only.
3. **Tenant isolation.** Any new store or filesystem access takes a `tenantId`
   (or a per-tenant volume) as a first-class parameter. Shared mutable state
   across tenants is a bug.
4. **Docs coupling.** Behavior changes update `README.md` and the relevant
   `docs/guides/*.md` in the same change. Examples must keep compiling against
   the public API they teach. Technical docs (`docs/**`, READMEs) follow
   `.cursor/rules/technical-docs.mdc` (STE100 + Orwell).
5. **Approval semantics.** If a change lets an agent write to memory, skills,
   or the filesystem, state where the approval boundary is and how it is
   enforced.

## Git conventions

- Conventional commits (`feat(core): ...`, `fix(sandbox): ...`), imperative
  subject, body explains why.
- Never commit `.env`, AgentFS volumes (`*.db`), or `node_modules`.
- Commit only when the user asks for it, unless the current task explicitly
  includes publishing.
