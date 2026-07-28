# AGENTS.md

agent-kit is a generic, reusable toolkit for building self-improving agents:
memory, skills, and curator primitives; an `agent/` authoring surface;
per-tenant AgentFS homes; and a guarded bash layer. It is a library, not a
hosted service. Product-specific logic never lands here.

## Read first

1. `RULES.md` at the repo root (the idea, global standards, verification gate).
2. The nearest `RULES.md` for the directory you are editing:
   `packages/<pkg>/RULES.md`, `examples/RULES.md`.

## Non-negotiables (summary)

- `@socialrobot-io/agent-kit-core`, `@socialrobot-io/agent-kit-sessions`, `@socialrobot-io/agent-kit-sandbox` are leaf
  packages. Dependencies only point inward; never add a sibling dep to a leaf.
  Host composition lives in `@socialrobot-io/agent-kit-node` (`createTenantHome`).
- Agent state (memory, skills, pending writes) lives in AgentFS volumes, never
  in Postgres or any external store. One volume per tenant, always.
- Memory and skill writes go through the write-approval gate when it is on.
  Never bypass it outside of an explicit human approval path.
- Externally sourced content is threat-scanned before it enters memory or
  skills.
- Tests never hit the network or need API keys. Live model paths are mocked.
- Before any commit: `npx nx run-many -t typecheck test build --all` is green.

## Key commands

| Task                    | Command                                         |
| ----------------------- | ----------------------------------------------- |
| Install deps            | `bun install`                                   |
| Verify everything       | `npx nx run-many -t typecheck test build --all` |
| Sync project references | `npx nx sync`                                   |
| Scaffold a package      | `npx nx g @nx/js:library` (always use the CLI)  |
| Run the offline demo    | `bun packages/cli/src/lib/demo.ts`              |
| Preview a release       | `bunx nx release patch --dry-run`               |
| Publish to npm          | Actions → Release (`docs/guides/publishing.md`) |

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
