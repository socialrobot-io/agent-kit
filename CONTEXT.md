# Domain glossary (agent-kit)

Vocabulary for product and architecture discussions. Prefer these nouns in
docs, PRDs, and deepenings.

## Company envelope

Sealed company rules for one tenant home: identity (`SOUL.md`, `AGENTS.md`),
skill locks, network allowlist, secrets, and (later) tool policy. Hosts configure
it; the kit enforces it in code.

## Tenant home

Process-local composition for one tenant volume (`createTenantHome`): volume,
transcripts, sandbox, session open, and agent install from a compiled bundle.

## Skill tiers

| Tier | Source | Mutability |
| ---- | ------ | ---------- |
| **Agent-folder skill** | Host `agent/skills/<name>/` | Unlocked unless marked (`locked`/`pinned`/`bundled` frontmatter or `.locked` file) |
| **Learned skill** | Agent / curator at runtime | Unlocked; write-approval gated |

Locked means the whole agentskills folder is immutable to agent tools, curator,
approve replay, and agent-facing FS writes. View/list still work.

## Write-approval gate

Default staging of memory and unlocked-skill writes under `pending/` until a
human approves. Interactive UI Approve is a paired path (`promptInline` +
toolApproval).

## Gated write

Core module that owns lock-check → gate → stage/apply for memory and skills.
Session tools, curator, and approve replay call the same seam.

## Privileged volume

Raw tenant AgentFS handle used only by the host for seed/deploy. Sessions use
`createAgentFs(volume)` and must not receive the privileged writer for tools.

## Agent compile

Build-time codegen (`compileAgent`) turns on-disk `agent/` into an importable
`.ts` / `.json` module exporting `agent`. Runtime uses
`createTenantHome({ agent })`. Portable across Next, Docker, workers, and plain
Node because the bundler ships a normal import.
