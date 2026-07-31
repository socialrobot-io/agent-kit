# Docs

agent-kit is a TypeScript library for multi-tenant agents with a **company
envelope**: sealed identity and locked skills, free work inside the sandbox,
and human-gated learning.

## Core concepts

| Concept | Guide |
| ------- | ----- |
| Company envelope + skill tiers | [Skills](guides/skills-and-learning.md) · [Security](guides/security.md) · [CONTEXT.md](../CONTEXT.md) |
| Per-tenant volume + auth → `createTenantHome` | [Hosting](guides/hosting.md) |
| Agents as files (`SOUL.md`, `AGENTS.md`, skills) | [Getting started](guides/getting-started.md) |
| Frozen memory snapshot | [Memory](guides/memory.md) |
| Skills, curator, approve | [Skills & learning](guides/skills-and-learning.md) |
| Guarded bash / `/workspace` (curl, JS/Python, custom cmds) | [Sandbox](guides/sandbox.md) |
| Default tools + `addTools` | [Tools](guides/tools.md) |
| Models, `run` / `stream` | [Models](guides/models.md) |

## Examples

| Example | Shows |
| ------- | ----- |
| [`examples/example-app`](../examples/example-app) | Streaming Next.js chat with sandbox + approval UI |
| [`examples/code-runner`](../examples/code-runner) | Agent that runs `js-exec` in the sandbox |

## Read in order (new integrators)

1. [Getting started](guides/getting-started.md): install, write `agent/` files, try a turn
2. [Host an agent in your app](guides/hosting.md): auth → seed envelope → `openSession`
3. [Security](guides/security.md): zones, locks, scans, scrubbing
4. [Tools](guides/tools.md): host tools vs sandbox vs skills
5. [Sandbox](guides/sandbox.md): curl, `js-exec`, `python3`, custom bash commands
6. [Models](guides/models.md): pick a model; use `session.run` / `session.stream`
7. [Memory](guides/memory.md): what the agent remembers across chats
8. [Skills & learning](guides/skills-and-learning.md): procedures, curator, human approve

Maintainers: [Publishing](guides/publishing.md).

## Roadmap

- [Company envelope PRD](roadmap/company-envelope-prd.md): sealed company identity and policy, free agents inside
- [Multi-machine](roadmap/multi-machine.md): not ready yet

Product pitch: [root README](../README.md).
