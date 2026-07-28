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
  savedSessions?: { id: string; createdAt: number; messageCount: number }[];
};

const STORAGE_KEY = "agent-kit.sessionId";

const SUGGESTIONS = [
  "I'm Nico. Keep answers in short bullets. My project is post-scheduler (Bun + Nx).",
  "What do you remember about me?",
  "Search past chats for Batman",
  "List the sandbox workspace and summarize README.md",
];

function newSessionId(): string {
  return crypto.randomUUID();
}

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
  // Hermes: one frozen memory snapshot per chat session. "New chat" mints a
  // new id so the next turn reloads MEMORY/USER from disk into the prompt.
  // Empty until mount so we restore localStorage before any history fetch.
  const [sessionId, setSessionId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        // useChat's `id` is the Hermes session boundary — freeze memory once per id.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { id, messages },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error, clearError, setMessages } = useChat({
    id: sessionId || "pending",
    transport,
    throttle: 40,
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const id = window.localStorage.getItem(STORAGE_KEY) ?? newSessionId();
    window.localStorage.setItem(STORAGE_KEY, id);
    setSessionId(id);
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady || !sessionId) return;
    window.localStorage.setItem(STORAGE_KEY, sessionId);
  }, [sessionReady, sessionId]);

  useEffect(() => {
    if (!sessionReady || !sessionId) return;
    let cancelled = false;
    void fetch(`/api/chat?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (r) => (await r.json()) as { ok?: boolean; messages?: UIMessage[] })
      .then((data) => {
        if (cancelled || !data.messages?.length) return;
        setMessages(data.messages);
      })
      .catch(() => {
        // History restore is best-effort.
      });
    return () => {
      cancelled = true;
    };
  }, [sessionReady, sessionId, setMessages]);

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
    if (!trimmed || busy || !sessionReady) return;
    clearError();
    setInput("");
    await sendMessage({ text: trimmed });
  }

  function onNewChat() {
    if (busy) return;
    clearError();
    const next = newSessionId();
    setMessages([]);
    setSessionId(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1>agent-kit</h1>
          <span className={styles.badge}>live</span>
        </div>
        <p>
          Streaming chat with durable transcripts in AgentFS (
          <code>sessions/</code>
          ). Batteries-included tools via <code>openAgentSession</code>. Memory
          freezes per chat session. Local volume only — see docs/roadmap for
          multi-machine.
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
              ? `${modelStatus.provider} / ${modelStatus.model}` +
                (modelStatus.savedSessions
                  ? ` · ${modelStatus.savedSessions.length} saved chat${modelStatus.savedSessions.length === 1 ? "" : "s"}`
                  : "")
              : modelStatus?.error || "checking model…"}
          <button type="button" className={styles.ghostLink} onClick={onNewChat} disabled={busy}>
            New chat
          </button>
        </div>
      </header>

      <section className={styles.thread} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <h2>Try the flywheel</h2>
            <p>
              Share something durable, then open New chat and ask what it
              remembers — or search past chats with session_search.
            </p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.suggestion}
                  onClick={() => void onSend(s)}
                  disabled={busy || !sessionReady}
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
          disabled={status === "submitted" || !sessionReady}
        />
        <div className={styles.row}>
          <span className={styles.hint}>Enter to send · Shift+Enter for newline</span>
          <div className={styles.actions}>
            {busy ? (
              <button type="button" className={styles.ghost} onClick={() => stop()}>
                Stop
              </button>
            ) : null}
            <button type="submit" disabled={busy || !input.trim() || !sessionReady}>
              {busy ? (status === "streaming" ? "Streaming…" : "Thinking…") : "Send"}
            </button>
          </div>
        </div>
        {error ? <p className={styles.error}>{error.message}</p> : null}
      </form>
    </main>
  );
}

