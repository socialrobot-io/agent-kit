"use client";

import { ChatShell } from "./chat-shell";

const SUGGESTIONS = [
  "Walk me through how you'd approach a tricky debugging session.",
  "Given a vague product brief, how do you turn it into a clear plan?",
  "Compare two solutions to a problem and say which you'd pick.",
  "Explain a concept step by step, then check my understanding.",
];

export default function Index() {
  return (
    <ChatShell
      api="/api/chat"
      storageKey="agent-kit.sessionId"
      title="agent-kit"
      badge="live"
      blurb="Talk to an agent that remembers this chat and can use tools. Start a new chat anytime for a fresh start."
      emptyTitle="Start a conversation"
      emptyBody="Ask anything. The agent reasons step by step, uses tools when needed, and keeps context across this chat."
      suggestions={SUGGESTIONS}
      activeNav="chat"
    />
  );
}
