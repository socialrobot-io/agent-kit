# RULES.md (@socialrobot-io/agent-kit-next)

Thin Next.js config wrapper. No runtime session or volume logic.

## Non-negotiables

1. **Config only.** Export `withAgentKit` (and small helpers). Do not import
   `@socialrobot-io/agent-kit-node` or open volumes here.
2. **Default agents dir is next to `app/`.** `agentsDir` defaults to `agents`
   (tracing glob `./agents/**/*`). Hosts may override with a relative path.
3. **One knob for the agents root.** `withAgentKit` sets both tracing and
   `env.AGENT_KIT_AGENTS_DIR` so `loadAgent("chat")` cannot diverge from the
   include glob.
4. **Merge, do not replace.** Preserve existing `serverExternalPackages`,
   `outputFileTracingIncludes`, and `env` entries from the host config.
5. **No hard runtime dependency on `next`.** Type against a local config shape;
   list `next` as an optional peer.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| Default externals / agentsDir / withAgentKit behavior | `src/lib/with-agent-kit.ts`, root `with-agent-kit.mjs` (must stay in sync — Node loads the `.mjs` before `dist/` exists), `with-agent-kit.spec.ts`, package README, root README Set up, hosting guide |
