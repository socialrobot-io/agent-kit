/**
 * Replay every staged memory + skill write, then discard the pending records.
 * Pattern mirrored from packages/cli/src/lib/demo.ts.
 */

import type { AgentSessionRuntime } from "@agent-kit/core";
import { applySkill } from "@agent-kit/curator";

export async function approveAllPending(runtime: AgentSessionRuntime): Promise<string[]> {
  const applied: string[] = [];

  for (const rec of await runtime.pending.list("memory")) {
    const { target, action, content, old_text } = rec.payload as Record<string, string>;
    if (action === "add") await runtime.memory.add(target as "user" | "memory", content);
    else if (action === "replace") {
      await runtime.memory.replace(target as "user" | "memory", old_text, content);
    } else if (action === "remove") {
      await runtime.memory.remove(target as "user" | "memory", old_text);
    }
    await runtime.pending.discard("memory", rec.id);
    applied.push(`memory:${rec.id} ${rec.summary}`);
  }

  for (const rec of await runtime.pending.list("skills")) {
    await applySkill(rec.payload, { skills: runtime.skills });
    await runtime.pending.discard("skills", rec.id);
    applied.push(`skills:${rec.id} ${rec.summary}`);
  }

  return applied;
}
