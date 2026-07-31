# RULES.md (@socialrobot-io/agent-kit-ai)

The model layer: resolves `defineAgent({ model })` to a live Vercel AI SDK
`LanguageModel`, adapts session tools to the SDK, and runs the agent loop.

## Non-negotiables

1. **Provider `LanguageModel` first; Gateway strings second.** Hosts should
   pass a ready `LanguageModel` from any AI SDK provider. String model ids are
   `"provider/model"` ids resolved through `@ai-sdk/gateway` (auth via
   `AI_GATEWAY_API_KEY`). Never add a provider-specific SDK dependency in this
   package; hosts bring their own provider, or use the gateway.
2. **Wrap the least amount possible.** The kit owns system prompt, tool
   composition, and the approval bridge. Call options are
   `Omit<Parameters<typeof generateText|streamText>[0], kitFilledKeys>` —
   do not invent parallel option types or cast away SDK types. Return
   `ReturnType` / `Awaited<ReturnType>` of the SDK functions. Do not add
   custom retry layers (`maxRetries` is the SDK's).
3. **AI SDK v7 (v4 spec) is pinned by reality.** Mocks and custom models must
   declare `specificationVersion: "v4"`. When upgrading `ai` or
   `@ai-sdk/gateway`, keep their spec versions in lockstep and re-run
   `agent-loop.spec.ts` first; spec mismatches fail at the type level in
   confusing places.
4. **Tool-call input is stringified JSON.** Any mock, custom runner, or
   provider shim that emits tool calls MUST set `input` to
   `JSON.stringify(args)`. A raw object makes the SDK treat the call as
   provider-executed and the client-side tool never runs. This is the most
   expensive bug this package has had; `mock-model` helpers encode it.
5. **The runtime owns the tool surface.** `runAgentTurn` converts
   `runtime.tools()` via `toAiTools` (`tool()` + `jsonSchema`) and defaults
   `stopWhen` via `stepCountIs(maxSteps)`. Hosts may override `stopWhen` and
   any other SDK call option on the turn.
6. **`aiCuratorRunner` is the only curator bridge.** Curator model calls go
   through it so the curator package stays SDK-agnostic (see its RULES.md).

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `AgentLoopOptions` / result shape | CLI demo, examples, `docs/guides/models.md` |
| `openAgentSession` / `session.run` | `open-session.spec.ts`, hosting + tools guides, example-app chat route |
| `ai` / gateway versions | mock models in every spec, `docs/guides/models.md`, example READMEs |
| Tool adaptation (`toAiTools`) | core `schemas.ts` parity, `agent-loop.spec.ts` |

## Gotchas

- `resolveModel` with a string requires `AI_GATEWAY_API_KEY` at call time;
  offline tests must inject mock `LanguageModel` instances instead.
- Keep this package free of core re-exports; consumers import types from
  `@socialrobot-io/agent-kit-core` directly.
