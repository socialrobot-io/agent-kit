# RULES.md (@agent-kit/core)

The foundation: agent definition (`defineAgent`), the `AgentSessionRuntime`
composition root, and memory, skills, approval, and threat primitives.
Everything else depends on this package; it depends on nothing.

## Non-negotiables

1. **Zero dependencies.** Never add a runtime dependency or an `@agent-kit/*`
   sibling dep to this package. If a helper needs one, it lives elsewhere
   (example: skill replay for approvals takes `applySkill` as an injected
   function in `approve.ts` precisely to avoid a core-curator cycle).
2. **Upstream semantic parity.** `memory.ts`, `skills.ts`, `approval.ts`, and
   `threats.ts` are deliberate ports of `vendor/hermes`. Behavior that upstream
   pins (the `"\n§\n"` entry delimiter, per-block character limits, the frozen
   memory snapshot taken at runtime init, gate decisions keyed off origin and
   write-approval config) is contractual. Change it only intentionally, update
   the porting comments, the specs, and `docs/guides/` in the same commit.
3. **AgentFS is the source of truth.** Memory, skills, and pending writes are
   read from and written to the injected `AgentFsLike`. Never introduce
   Postgres, Redis, or any external store for agent state here.
4. **The `AgentFsLike` contract is load-bearing.** `readFile` returns `null`
   (never throws) on missing files; `list` returns `[]` on missing directories;
   `deleteFile` is optional but required by pending-store discard and skill
   deletion. Adapters in other packages and apps rely on exactly this.
5. **Threat-scan at trust boundaries.** Any content that crosses from an
   untrusted source (tool output, transcript text, external files) into memory
   or skills goes through `scanForThreats` / `firstThreatMessage`. New write
   paths must scan too.
6. **Frozen snapshot semantics.** `systemPrompt()` serves the memory snapshot
   captured at `init()`, so mid-session writes never silently mutate the
   running prompt. Do not make the prompt live-read memory without a major
   design discussion.

## When you change X, also update Y

| Change | Also update |
| ------ | ----------- |
| Tool surface (`schemas.ts`, tool names/args) | `packages/ai` tool adapter, examples, `docs/guides/models.md` |
| Memory/skills file layout | `packages/curator` prompts, seed logic in examples, `docs/guides/memory.md` |
| Gate or pending-record shape | `packages/curator`, `approve.ts` callers, `docs/guides/skills-and-learning.md` |

## Gotchas

- `ENTRY_DELIMITER` is a string; join with `entries.join(ENTRY_DELIMITER)`.
- Pending write `payload` is the exact tool-args object; approval replays it
  verbatim. Keep payload shapes in sync with the tool schemas.
