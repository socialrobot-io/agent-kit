# AGENTS.md

agent-kit is a generic, reusable toolkit for building self-improving agents:
Hermes-derived memory/skills/curator primitives, an Eve-like `agent/` authoring
surface, per-tenant AgentFS homes, and a guarded bash layer. It is a library,
not a hosted service. Product-specific logic never lands here.

## Read first

1. `RULES.md` at the repo root (the idea, global standards, verification gate).
2. The nearest `RULES.md` for the directory you are editing:
   `packages/<pkg>/RULES.md`, `examples/RULES.md`.

## Non-negotiables (summary)

- `@agent-kit/core`, `@agent-kit/sessions`, `@agent-kit/sandbox` are leaf
  packages. Dependencies only point inward; never add a sibling dep to a leaf.
- Agent state (memory, skills, pending writes) lives in AgentFS volumes, never
  in Postgres or any external store. One volume per tenant, always.
- Memory and skill writes go through the write-approval gate when it is on.
  Never bypass it outside of an explicit human approval path.
- Externally sourced content is threat-scanned before it enters memory or
  skills.
- Tests never hit the network or need API keys. Live model paths are mocked.
- Before any commit: `npx nx run-many -t typecheck test build --all` is green.

## Key commands

| Task | Command |
| ---- | ------- |
| Install deps | `bun install` |
| Verify everything | `npx nx run-many -t typecheck test build --all` |
| Sync project references | `npx nx sync` |
| Scaffold a package | `npx nx g @nx/js:library` (always use the CLI) |
| Run the offline demo | `bun packages/cli/src/lib/demo.ts` |
