# Changelog

## 0.1.0

- Secure-by-default: `defineAgent` enables write approval for memory and skills.
- Batteries-included tools: `openAgentSession`, `composeAgentTools`, `addTools` / `disableTools` / `toolSet`.
- Durable `FileTranscriptStore` (append JSONL) + `FileSandboxAuditStore` + `assertTenantSession`.
- Local AgentFS helpers: `openAgentFs`, `serializeAgentFs`.
- Docs: hosting (local single-node), tools guide, multi-machine roadmap (deferred).
- CI: tests, build, typecheck; gitleaks + critical audit.
