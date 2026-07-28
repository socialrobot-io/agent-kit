# RULES.md (@agent-kit/curator)

The background reviewer: Hermes-compatible review prompts and
`runBackgroundReview`, which turns session transcripts into proposed memory and
skill writes.

## Non-negotiables

1. **The curator is untrusted.** It reviews conversations it did not
   participate in, so treat transcript content as adversarial input. It gets a
   restricted tool surface (memory, skills_list, skill_view, skill_manage)
   injected through `CuratorModelRunner`; never hand it sandbox tools, shell
   access, or host-specific extras.
2. **Approval semantics flow through `writeApprovalEnabled`.** When the gate is
   on for a subsystem, writes are staged into `PendingWriteStore` and nothing
   is applied. When it is off, writes apply immediately. Never add a third
   path that writes memory or skills directly, bypassing both.
3. **Prompt fidelity.** `MEMORY_REVIEW_PROMPT`, `SKILL_REVIEW_PROMPT`, and
   `COMBINED_REVIEW_PROMPT` mirror `vendor/hermes` background-review prompts.
   Edit them deliberately and note the divergence; they encode what counts as
   durable knowledge versus noise.
4. **Depends on core only.** Never import from sandbox, sessions, or ai. The
   model is injected as a `CuratorModelRunner` function; the curator must not
   know which SDK or provider produced it.
5. **Outcome shape is stable.** `{ reviewText, staged, applied, errors }` is
   consumed by the CLI, examples, and tests. Extend additively only.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| Review prompts | `curator.spec.ts` expectations, `docs/guides/skills-and-learning.md` |
| `CuratorModelRunner` signature | `packages/ai` (`aiCuratorRunner`), examples, `docs/guides/models.md` |
| Staging payload contents | `packages/core` approval replay (`approve.ts`) and pending specs |

## Gotchas

- `applySkill` lives here (not in core) to keep core dependency-free; core's
  approval helper receives it as an injected function.
- The runner contract asks models for tool calls by name; runners that
  hallucinate unknown tool names must be surfaced in `errors`, not applied.
