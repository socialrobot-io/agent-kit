# RULES.md (@socialrobot-io/agent-kit-node)

Host composition layer. Wires volume + transcripts + sandbox + `openAgentSession`
+ after-turn curator with convention-over-configuration defaults. Leaves stay
pure; this package may depend on sibling packages (including curator).

## Non-negotiables

1. **Auth stays in the host.** `createTenantHome` never reads cookies or JWTs.
   The host passes a stable `tenantId`.
2. **Composable.** Expose `volume`, `transcripts`, `bash` so hosts can replace
   pieces. `openSession` accepts the same overrides as `openAgentSession`.
3. **One home per tenant volume path per process.** Cache by path; do not open
   the same SQLite file twice.
4. **Curator is baked into `openSession`.** After each turn, when
   `definition.config.curator` is not `false`, schedule `runBackgroundReview`
   without blocking the reply. Toggle only via `defineAgent` config (or
   `curatorRunner` for the model seam). When `curator.autoApprove` is true,
   pass `writeApprovalEnabled: () => false` into that run only so proposals
   apply immediately; do not change foreground `writeApproval`.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `createTenantHome` options / defaults | `tenant-home.spec.ts`, README quick start, `docs/guides/hosting.md` |
| `compileAgent` / `agent` on home | `compile-agent.spec.ts`, `tenant-home.spec.ts`, hosting guide, CONTEXT.md |
| Curator wiring / `config.curator` | `session-curator.ts`, `tenant-home.spec.ts`, skills-and-learning + hosting guides |
