# RULES.md (@agent-kit/ai)

The model layer: resolves `defineAgent({ model })` to a live Vercel AI SDK
`LanguageModel`, adapts Hermes tools to the SDK, and runs the agent loop.

## Non-negotiables

1. **Gateway-first model resolution.** String model ids are `"provider/model"`
   ids resolved through `@ai-sdk/gateway` (auth via `AI_GATEWAY_API_KEY`).
   `LanguageModel` instances pass through untouched so hosts can bring any
   provider. Never add a provider-specific SDK dependency; the gateway covers
   them.
2. **AI SDK v7 (v4 spec) is pinned by reality.** Mocks and custom models must
   declare `specificationVersion: "v4"`. When upgrading `ai` or
   `@ai-sdk/gateway`, keep their spec versions in lockstep and re-run
   `agent-loop.spec.ts` first; spec mismatches fail at the type level in
   confusing places.
3. **Tool-call input is stringified JSON.** Any mock, custom runner, or
   provider shim that emits tool calls MUST set `input` to
   `JSON.stringify(args)`. A raw object makes the SDK treat the call as
   provider-executed and the client-side tool never runs. This is the most
   expensive bug this package has had; `mock-model` helpers encode it.
4. **The runtime owns the tool surface.** `runAgentTurn` converts
   `runtime.tools()` via `toAiTools` and stops via `stopWhen(stepCountIs)`. Do
   not reimplement tool wiring per host; extend `AgentLoopOptions` instead.
5. **`aiCuratorRunner` is the only curator bridge.** Curator model calls go
   through it so the curator package stays SDK-agnostic (see its RULES.md).

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `AgentLoopOptions` / result shape | CLI demo, examples (`main.ts`, `chat.ts`), `docs/guides/models.md` |
| `ai` / gateway versions | mock models in every spec, `docs/guides/models.md`, example READMEs |
| Tool adaptation (`toAiTools`) | core `schemas.ts` parity, `agent-loop.spec.ts` |

## Gotchas

- `resolveModel` with a string requires `AI_GATEWAY_API_KEY` at call time;
  offline tests must inject mock `LanguageModel` instances instead.
- Keep this package free of core re-exports; consumers import types from
  `@agent-kit/core` directly.
