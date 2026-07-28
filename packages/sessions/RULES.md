# RULES.md (@agent-kit/sessions)

Session transcripts and full-text search: the `TranscriptStore` interface, the
in-memory reference implementation, and `sessionSearch`.

## Non-negotiables

1. **Every query is tenant-scoped.** `sessionSearch` and any future store
   method takes `tenantId` and must never return another tenant's sessions or
   messages, even when searching by `session_id` alone.
2. **The interface is the product.** `TranscriptStore` exists so hosts can plug
   in Postgres (SocialRobot's `AgentSession`/`AgentMessage`) or anything else.
   Keep it minimal and storage-agnostic: create session, append message,
   search. Do not leak in-memory specifics into the interface.
3. **Search semantics are Hermes-compatible.** Query OR session filter, plus
   `offset`/`limit` pagination, returning stable result shapes the curator and
   tools already consume.
4. **Leaf package.** No `@agent-kit/*` dependencies.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `TranscriptStore` interface | `InMemoryTranscriptStore`, `sessionSearch`, `README.md`, any host adapters |
| Result shape | curator consumers and examples that read transcripts |

## Gotchas

- Timestamps are epoch seconds (Hermes convention), not milliseconds.
- Tool calls on assistant messages are stored alongside content; search must
  be able to surface them, so do not strip them in implementations.
