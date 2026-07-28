# RULES.md (@socialrobot-io/agent-kit-sandbox)

The safe execution layer: a bash-tool `Sandbox` backed by a per-tenant AgentFS
volume, command guardrails, and an append-only audit store.

## Non-negotiables

1. **One volume per tenant.** `TenantAgentFSSandbox` always receives a
   tenant-scoped AgentFS volume. Never open a shared volume and separate by
   path prefix; isolation must come from the storage layer itself.
2. **Fail closed.** `evaluateCommand` decides before anything executes.
   Destructive patterns (`rm -rf /`, forks, disk writes outside the volume) and
   exfiltration patterns (pipes to `curl`/`nc`, env dumping of secrets) are
   denied by default. When unsure whether a pattern is safe, deny and add a
   test.
3. **Audit everything.** Every executed command and every denied command
   produces a `SandboxAuditRecord` with tenantId, command, decision, and
   timestamp. Audit stores are append-only; never add update or delete methods.
4. **The bash-tool `Sandbox` interface is the contract.** Method behavior
   (cwd handling, env, output capture) follows `bash-tool`'s expectations so
   the AI SDK bash tool works unmodified. Verify against the `bash-tool`
   type defs before changing signatures.
5. **Leaf package.** No `@socialrobot-io/agent-kit-*` dependencies. Guardrails and audit are
   standalone so any host (with or without core) can adopt them.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| Guardrail patterns | `guardrails.spec.ts` with positive AND negative cases, `docs/guides/sandbox.md` |
| Sandbox interface usage | `tenant-sandbox.spec.ts`, the CLI demo wiring, `docs/guides/sandbox.md` |

## Gotchas

- Guardrails inspect the raw command string; obfuscated payloads (base64,
  hex escapes) must be decoded before evaluation or treated as suspicious.
- `AgentFS.open({ path })` requires the parent directory to exist; create it
  with `mkdir(..., { recursive: true })` first.
