"use client";

import { ChatShell } from "../chat-shell";

const SUGGESTIONS = [
  "Using js-exec, compute the sum of 1..20 and show the command.",
  "Write a small script under /workspace that sorts a list, then run it with js-exec.",
  "What tools do you have? Try server_time and ls /workspace.",
  "Explain how js-exec differs from host Node, then prove it with a one-liner.",
];

export default function CodeRunnerPage() {
  return (
    <ChatShell
      api="/api/code-runner/chat"
      storageKey="agent-kit.code-runner.sessionId"
      title="code runner"
      badge="js-exec"
      blurb="Sandboxed JavaScript via just-bash js-exec. Separate volume and agent from the main chat demo."
      emptyTitle="Run code in the sandbox"
      emptyBody="Ask for a calculation or a short script. The agent should use js-exec (and writeFile for longer files)."
      suggestions={SUGGESTIONS}
      activeNav="code-runner"
    />
  );
}
