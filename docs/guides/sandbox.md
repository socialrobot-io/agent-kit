# Sandbox

A safe body for the agent — isolated storage and a guarded shell.

## Why it exists

An agent with raw shell access is a liability. It can delete files, dump
credentials, or call arbitrary hosts. In a multi-tenant product, one bad
command can become someone else's breach.

agent-kit does not hand the agent your host. It hands the agent a
**per-tenant [AgentFS](https://www.agentfs.ai/) volume** and runs commands
inside that volume through a [bash-tool](https://github.com/vercel-labs/bash-tool)
sandbox with guardrails.

## What is isolated

Each tenant gets:

- Its own filesystem (skills, memory, pending writes, workspace files)
- Its own command audit trail
- Its own snapshots (rollback-ready)

Tenant A's files and commands never share storage with tenant B.

## Guardrails (before execution)

Every bash command is evaluated first:

| Blocked | Examples |
| ------- | -------- |
| Destructive | `rm -rf /`, fork bombs, writing block devices, shutdown |
| Credential exfil | `curl … $SECRET`, `cat .env`, SSH private key paths |
| Bad egress | Any URL whose host is not on your allowlist |

Configured secrets are **redacted** from the command line before it runs or is
logged. A blocked command returns a clear error to the agent instead of
running.

## Audit trail

Every command, file read, and file write is recorded with:

- the tenant
- the command or path
- files touched (best-effort)
- exit code
- the post-action snapshot id

That is what you show in a compliance UI — and what you use to roll a volume
back.

## Fit with the rest of the stack

The sandbox is one wall of the [security model](security.md). Content is
scanned before it reaches the prompt. Learning is gated by human approval.
Actions are sandboxed. Tenants are isolated.

Together: agents you can put behind a paying customer.
