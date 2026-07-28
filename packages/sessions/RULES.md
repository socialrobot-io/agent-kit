# RULES.md (@agent-kit/sessions)

Session transcripts and search: the `TranscriptStore` interface, file +
in-memory implementations, `sessionSearch`, and `createSessionSearchTool`.

## Non-negotiables

1. **Every query is tenant-scoped.** `sessionSearch` and any future store
   method takes `tenantId` and must never return another tenant's sessions or
   messages, even when searching by `session_id` alone. Use `assertTenantSession`
   before serving history to a caller.
2. **The interface is the product.** `TranscriptStore` exists so hosts can plug
   in Postgres later. Keep it minimal and storage-agnostic.
3. **Prefer one store per tenant volume** (`FileTranscriptStore` on that FS).
4. **Leaf package.** No `@agent-kit/*` dependencies.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| `TranscriptStore` interface | `InMemoryTranscriptStore`, `FileTranscriptStore`, `sessionSearch`, docs |
| Result shape | curator consumers and examples that read transcripts |

## Gotchas

- Timestamps are epoch seconds (not milliseconds).
- Built-in search is substring scan (fine for short-lived sessions).
