"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";

type Status = {
  ok: boolean;
  model?: string;
  provider?: string;
  error?: string;
};

const SUGGESTIONS = [
  "I'm Nico. Keep answers in short bullets. My project is post-scheduler (Bun + Nx).",
  "What do you remember about me?",
  "List the sandbox workspace and summarize README.md",
  "Write a short note to notes/agent-kit.txt saying the bash sandbox works",
];

function toolNameFromPartType(type: string): string {
  return type.startsWith("tool-") ? type.slice(5) : type;
}

function ToolPart({ part }: { part: { type: string; [key: string]: unknown } }) {
  const name = toolNameFromPartType(part.type);
  const state = typeof part.state === "string" ? part.state : "running";
  const input = part.input ?? part.args;
  const output = part.output ?? part.result;

  let body = "";
  if (state === "output-available" || state === "result") {
    body = JSON.stringify(output ?? input ?? {}, null, 2);
  } else if (input != null) {
    body = JSON.stringify(input, null, 2);
  } else {
    body = "…";
  }

  return (
    <div className={styles.tool}>
      <div className={styles.toolHead}>
        <span>{name}</span>
        <span>{state.replace(/-/g, " ")}</span>
      </div>
      <div className={styles.toolBody}>{body}</div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  const parts = message.parts ?? [];
  return (
    <article className={`${styles.bubble} ${styles[message.role === "user" ? "user" : "assistant"]}`}>
      <div className={styles.role}>{message.role === "user" ? "You" : "Agent"}</div>
      <div className={styles.parts}>
        {parts.map((part, i) => {
          if (part.type === "text") {
            const text = "text" in part ? String(part.text ?? "") : "";
            return (
              <div key={`${message.id}-text-${i}`} className={styles.text}>
                {text}
                {streaming && i === parts.length - 1 ? <span className={styles.caret} aria-hidden /> : null}
              </div>
            );
          }
          if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
            return <ToolPart key={`${message.id}-tool-${i}`} part={part as { type: string }} />;
          }
          return null;
        })}
        {streaming && parts.length === 0 ? <span className={styles.caret} aria-hidden /> : null}
      </div>
    </article>
  );
}

export default function Index() {
  const [input, setInput] = useState("");
  const [modelStatus, setModelStatus] = useState<Status | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
    throttle: 40,
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    void fetch("/api/chat")
      .then(async (r) => (await r.json()) as Status)
      .then(setModelStatus)
      .catch((err: unknown) =>
        setModelStatus({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function onSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    setInput("");
    await sendMessage({ text: trimmed });
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1>agent-kit</h1>
          <span className={styles.badge}>live</span>
        </div>
        <p>
          Streaming chat over a persistent AgentFS home plus a just-bash
          sandbox (bash / readFile / writeFile). Memory, skills, and workspace
          tools stick across reloads.
        </p>
        <div className={styles.meta}>
          <span
            className={`${styles.dot} ${
              busy ? styles.busy : modelStatus?.ok ? styles.ok : styles.bad
            }`}
            aria-hidden
          />
          {busy
            ? status === "streaming"
              ? "streaming"
              : "thinking"
            : modelStatus?.ok
              ? `${modelStatus.provider} / ${modelStatus.model}`
              : modelStatus?.error || "checking model…"}
        </div>
      </header>

      <section className={styles.thread} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <h2>Try the flywheel</h2>
            <p>
              Share something durable, then ask what it remembers. Tool calls
              stream in as they happen.
            </p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => void onSend(s)}
                  disabled={busy}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              streaming={
                busy &&
                message.role === "assistant" &&
                index === messages.length - 1
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </section>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          void onSend(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message the agent…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend(input);
            }
          }}
          disabled={status === "submitted"}
        />
        <div className={styles.row}>
          <span className={styles.hint}>Enter to send · Shift+Enter for newline</span>
          <div className={styles.actions}>
            {busy ? (
              <button type="button" className={styles.ghost} onClick={() => stop()}>
                Stop
              </button>
            ) : null}
            <button type="submit" disabled={busy || !input.trim()}>
              {busy ? (status === "streaming" ? "Streaming…" : "Thinking…") : "Send"}
            </button>
          </div>
        </div>
        {error ? <p className={styles.error}>{error.message}</p> : null}
      </form>
    </main>
  );
}
