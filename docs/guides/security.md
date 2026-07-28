# Security & isolation

agent-kit is built for multi-tenant production, not for demos. Security is not
an addon — it is the default path.

## The threat model

An agent in production faces four failure modes:

1. **Content attacks** — prompt injection, promptware, and exfiltration payloads
   that try to rewrite the system prompt or steal secrets.
2. **Dangerous actions** — shell commands that delete files, dump credentials, or
   reach arbitrary hosts.
3. **Silent self-modification** — an autonomous process that quietly rewrites its
   own memory or skills into a worse (or adversarial) state.
4. **Cross-tenant leakage** — tenant A's memory, skills, transcripts, or files
   becoming visible to tenant B.

Each gets its own wall.

## Defense in depth

### 1. Threat scanning

Every memory write and skill install is scanned for injection, promptware/C2,
credential exfil patterns, and invisible unicode. Hits are refused with a
reason.

On-disk memory is re-scanned when the system-prompt snapshot is built. A
poisoned entry never reaches the model as instructions — it renders as
`[BLOCKED: …]` so a human can inspect and remove it.

### 2. Write approval

Learning is gated. When write-approval is on:

- Background (curator) writes always stage.
- Skill writes always stage.
- Nothing autonomous becomes permanent without a human.

Staged writes live under `pending/{memory,skills}/` and are replayed only on
approve. Reject them and they disappear.

### 3. Sandbox guardrails

The agent does not get your host shell. It gets a per-tenant AgentFS volume and
a guarded bash layer that blocks, before execution:

- Destructive patterns (`rm -rf /`, fork bombs, writing block devices, …)
- Credential exfiltration (`curl … $SECRET`, `cat .env`, SSH key paths, …)
- Network egress to hosts that are not on your allowlist

Configured secrets are redacted from the command line before it runs or is
logged.

### 4. Tenant isolation

One AgentFS volume per tenant means:

| Isolated | Why it matters |
| -------- | -------------- |
| Filesystem | Files, skills, memory, pending writes never share storage |
| Memory | USER.md / MEMORY.md are per-tenant |
| Skills | Distilled procedures stay with the brand that earned them |
| Transcripts | Full-text recall is tenant-scoped |
| Audit trail | Compliance views and rollback are per-tenant |

A bug in tenant A cannot touch tenant B. That is the multi-tenancy guarantee.

## Audit & rollback

Every sandbox command, file read, and file write emits an append-only record
with the subject, files touched, exit code, and the post-action snapshot id.
You can show a compliance UI what the agent did — and roll a volume back to any
snapshot.

## What this is not

agent-kit does not claim to make agents "safe forever." It makes the default
path the hard path for attackers and the easy path for operators: scan content,
gate learning, sandbox actions, isolate tenants, keep an audit trail.
