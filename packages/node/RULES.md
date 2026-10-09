# RULES.md (@socialrobot-io/agent-kit-node)

Host composition layer. Wires storage (volume + transcripts) + sandbox +
`openAgentSession` + after-turn curator with convention-over-configuration
defaults. Leaves stay pure; this package may depend on sibling packages
(including curator).

## Non-negotiables

1. **Auth stays in the host.** `createTenantHome` never reads cookies or JWTs.
   The host passes a stable `tenantId`.
2. **Composable.** Expose `volume`, `transcripts`, `bash` so hosts can replace
   pieces. `openSession` accepts the same overrides as `openAgentSession`.
3. **One open storage per key per process.** Cache the opened storage (and
   its file transcript store) by `StorageAdapter.key(tenantId)` (the volume
   path for AgentFS). Each kit builds its own home on it (`openTenantHome`);
   `createTenantHome` also caches one home per key. Throw when a second
   tenant uses a key that is already open; never hand tenant A's home or
   storage to tenant B.
4. **Curator is baked into `openSession`.** After each turn, when
   `definition.config.curator` is not `false`, schedule `runBackgroundReview`
   without blocking the reply. Toggle only via `defineAgent` config (or
   `curatorRunner` for the model seam). When `curator.autoApprove` is true,
   pass `writeApprovalEnabled: () => false` into that run only so proposals
   apply immediately; do not change foreground `writeApproval`. With
   `curatorQueue`, hand the job to the host instead of running it.
5. **Sandbox loads lazily.** Import `@socialrobot-io/agent-kit-sandbox` values
   only through `loadSandbox()` (type imports are fine), so hosts on other
   storage with `sandbox: false` never load AgentFS or just-bash.
6. **Curator jobs carry no policy.** `CuratorJob` holds the tenant, chat id,
   and conversation. Mode, `autoApprove`, and write approval come from the
   definition of the home that runs `review`. Validate jobs with
   `parseCuratorJob` at the queue boundary.

## Postgres adapter (`src/postgres`, export `./postgres`)

1. **No driver dependency.** Talk to Postgres only through `SqlClient`. The
   driver shims (`fromPg`, `fromPrisma`, `fromPostgresJs`, `fromPglite`) are
   structural and import nothing. Never import `src/postgres` from the main
   entry.
2. **Tenant-bound objects.** `PostgresVolume` and `PostgresTranscriptStore`
   take a `tenantId` at construction, and every statement filters on it. A
   call that names another tenant returns nothing or throws. Only
   `maintenance.ts` (operator helpers) may touch many tenants.
3. **Driver-neutral SQL.** Use `$n` placeholders with explicit casts. Select
   only text, int4, float8, and boolean columns (cast `count(*)`, timestamps,
   and jsonb): Prisma returns `BigInt` and `Date` otherwise.
4. **Validated identifiers.** Table names come from `resolveTables`. Never
   put caller input into SQL text.
5. **Core contract.** `readFile` returns `null` when missing, `list` returns
   `[]` when missing, `deleteFile` on a missing path does nothing. Keep
   `exclusive` re-entrant and transactional.
6. **ORM-friendly schema.** Plain columns, composite primary keys, btree
   indexes, no extension.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `createTenantHome` options / defaults | `tenant-home.spec.ts`, README quick start, `docs/guides/hosting.md` |
| `compileAgent` / `loadAgent` | `compile-agent.spec.ts`, `tenant-home.spec.ts`, README set up, hosting guide |
| `createAgentKit` / `AgentKit` | `agent-kit.spec.ts`, README set up, hosting guide |
| Curator wiring / `config.curator` | `session-curator.ts`, `tenant-home.spec.ts`, skills-and-learning + hosting guides |
| `StorageAdapter` / `TenantStorage` | `storage.spec.ts`, `src/postgres/postgres-storage.ts`, `docs/guides/storage.md` |
| Postgres table layout (`src/postgres/schema.ts`) | `sql.spec.ts`, storage guide (tables, Prisma snippet). Note the migration in the changelog. |
| Postgres volume, transcript, or lock behavior | `src/postgres/*.spec.ts` (run them with `AGENT_KIT_TEST_DATABASE_URL` too), storage and memory guides |
| `curatorQueue` / `CuratorJob` / `review` | `storage.spec.ts`, `docs/guides/storage.md`, skills-and-learning guide |
