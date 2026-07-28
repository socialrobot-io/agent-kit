/**
 * Persist useChat UI messages into the tenant TranscriptStore.
 */

import type { UIMessage } from "ai";
import type { TranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import { TENANT_ID } from "./agent";

function textFromUiMessage(message: UIMessage): string {
  const parts = message.parts ?? [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

function roleFromUiMessage(message: UIMessage): "user" | "assistant" | "system" | "tool" | null {
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    return message.role;
  }
  return null;
}

/** Append any UI messages not yet in the store (idempotent by message id). */
export async function persistUiMessages(
  transcripts: TranscriptStore,
  sessionId: string,
  messages: UIMessage[],
): Promise<void> {
  await transcripts.createSession({
    id: sessionId,
    tenantId: TENANT_ID,
    source: "composer",
    createdAt: Date.now() / 1000,
  });

  let i = 0;
  for (const message of messages) {
    const role = roleFromUiMessage(message);
    if (!role) continue;
    const content = textFromUiMessage(message);
    if (!content && role !== "assistant") continue;
    await transcripts.appendMessage({
      id: message.id,
      sessionId,
      role,
      content: content || "(empty)",
      createdAt: Date.now() / 1000 + i++ * 0.001,
    });
  }
}

/** Convert stored transcript messages back into UIMessage-shaped objects for useChat. */
export function transcriptToUiMessages(
  messages: { id: string; role: string; content: string }[],
): UIMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: m.content }],
    }));
}
