# RULES.md (@socialrobot-io/agent-kit-node)

Host composition layer. Wires volume + transcripts + sandbox + `openAgentSession`
with convention-over-configuration defaults. Leaves stay pure; this package may
depend on sibling packages.

## Non-negotiables

1. **Auth stays in the host.** `createTenantHome` never reads cookies or JWTs.
   The host passes a stable `tenantId`.
2. **Composable.** Expose `volume`, `transcripts`, `bash` so hosts can replace
   pieces. `openSession` accepts the same overrides as `openAgentSession`.
3. **One home per tenant volume path per process.** Cache by path; do not open
   the same SQLite file twice.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `createTenantHome` options / defaults | `tenant-home.spec.ts`, README quick start, `docs/guides/hosting.md` |
