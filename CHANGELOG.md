## 0.2.4 (2026-07-31)

This was a version bump only, there were no code changes.

## 0.2.3 (2026-07-31)

### 🚀 Features

- **ai:** pass through AI SDK call options and tighten docs ([31c6ef4](https://github.com/socialrobot-io/agent-kit/commit/31c6ef4))

### ❤️ Thank You

- Cursor @cursoragent
- Nicolas Torres

## 0.2.2 (2026-07-31)

### 🚀 Features

- ship company envelope with compileAgent host install ([#12](https://github.com/socialrobot-io/agent-kit/pull/12))
- bake curator into createTenantHome + clarify docs ([#14](https://github.com/socialrobot-io/agent-kit/pull/14))

### 🩹 Fixes

- **ci:** push releases with admin RELEASE_TOKEN ([734cb2f](https://github.com/socialrobot-io/agent-kit/commit/734cb2f))

### ❤️ Thank You

- Cursor @cursoragent
- Nicolas Torres

## 0.2.1 (2026-07-29)

### 🩹 Fixes

- **node:** publish `@socialrobot-io/agent-kit-node@0.2.1` (0.2.0 was unpublished after a bad tarball with `workspace:*` deps; that version cannot be reused on npm)

## 0.2.0 (2026-07-29)

### 🚀 Features

- **node:** new `@socialrobot-io/agent-kit-node` with `createTenantHome` (volume, transcripts, sandbox, session by convention)
- **ai:** rename `AgentSessionHandle` → `AgentSession`; expose `memory` / `skills` / `pending` on the session
- **core:** skill create/edit validate agentskills.io frontmatter (Hermes parity: name, description, body, 60-char index budget)

### 🩹 Fixes

- Docs and example-app use the TenantHome happy path

## 0.1.1 (2026-07-28)

### 🚀 Features

- port Hermes self-improvement primitives into a TS agent toolkit ([4a1364a](https://github.com/socialrobot-io/agent-kit/commit/4a1364a))
- **ai:** real model loop via Vercel AI SDK v7 ([0eea4ea](https://github.com/socialrobot-io/agent-kit/commit/0eea4ea))
- **example:** live DeepSeek example app with AgentFS persistence ([9215589](https://github.com/socialrobot-io/agent-kit/commit/9215589))
- **example:** Next.js chat with AI SDK UI, DeepSeek, and bash sandbox ([d311973](https://github.com/socialrobot-io/agent-kit/commit/d311973))
- **sessions:** persist chat transcripts and add CI security gates ([4cd004b](https://github.com/socialrobot-io/agent-kit/commit/4cd004b))

### 🩹 Fixes

- **example:** Hermes session memory freeze and AgentFS-backed workspace ([13ac7fb](https://github.com/socialrobot-io/agent-kit/commit/13ac7fb))
- **sandbox:** align just-bash with official Bash + bash-tool setup ([0903c0d](https://github.com/socialrobot-io/agent-kit/commit/0903c0d))

### ❤️ Thank You

- Cursor @cursoragent
- Nicolas Torres

# Changelog

## 0.1.0

- Secure-by-default: `defineAgent` enables write approval for memory and skills.
- Batteries-included tools: `openAgentSession`, `composeAgentTools`, `addTools` / `disableTools` / `toolSet`.
- Durable `FileTranscriptStore` (append JSONL) + `FileSandboxAuditStore` + `assertTenantSession`.
- Local AgentFS helpers: `openAgentFs`, `serializeAgentFs`.
- Docs: hosting (local single-node), tools guide, multi-machine roadmap (deferred).
- CI: tests, build, typecheck; gitleaks + critical audit.
