# RULES.md (examples/*)

Examples are teaching material: they prove the toolkit end to end and show
hosts how to compose it. Every example follows the same contract.

## Non-negotiables

1. **Offline test, always.** Each example ships a vitest smoke test that runs
   with no API key and no network: mock `LanguageModel` (v4 spec, stringified
   tool-call `input`) plus `InMemoryFs`. Live AgentFS volumes and real model
   calls never appear in tests.
2. **Live paths are env-driven and fail helpfully.** Config comes from
   `.env.sample`-documented variables (`AI_GATEWAY_API_KEY`, `MODEL`). When a
   required var is missing, print setup instructions and exit 1; never throw a
   raw stack at the user.
3. **Seeding never clobbers learned state.** On-disk `agent/` files seed the
   volume only when each target file is absent. The agent's memory, skills, and
   pending writes must survive re-runs untouched.
4. **AgentFS adapter rules.** Live runs use a real per-tenant AgentFS volume
   adapted to `AgentFsLike` (readFile => null on miss, list => [] on miss,
   deleteFile via `unlink`, writeFile creates parents). Create the volume's
   parent directory before `AgentFS.open({ path })`. Gitignore the volume
   (`*.db`) and `.env`.
5. **Examples are top-level consumers only.** They depend on published package
   APIs (`workspace:*`), never on `src/` internals, and nothing in `packages/`
   may import from `examples/`.
6. **Docs stay in lockstep.** Each example has its own README (what it shows,
   setup, commands) and is linked from the root README. If package behavior
   changes, update the example and its README in the same commit.

## House style

- Bun scripts (`bun src/main.ts`), no build step; a `tsconfig.json` exists for
  editor support and the `typecheck` target.
- Scripted demos narrate the loop with clear section headers (Session 1,
  Curator, Approve, Session 2) and print tool calls and staged writes so the
  mechanics are visible.
- Resolve package-relative paths via `import.meta.url`, never `process.cwd()`.
