# @socialrobot-io/agent-kit-ai

Live model loop on the Vercel AI SDK. Resolves `defineAgent({ model })`, runs
turns, streams, and builds curator runners.

## Peer dependency

Install the Vercel AI SDK next to this package:

```bash
npm i @socialrobot-io/agent-kit-ai ai
```

`ai` is a peer (`^7.0.0`) so hosts share one SDK copy with their provider
packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, …).

## Build

```bash
npx nx build ai
```

## Test

```bash
npx nx test ai
```
