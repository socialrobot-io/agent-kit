"use client";

import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./page.module.css";

export type ChatShellProps = {
  api: string;
  storageKey: string;
  title: string;
  badge: string;
  blurb: string;
  emptyTitle: string;
  emptyBody: string;
  suggestions: string[];
  activeNav: "chat" | "code-runner";
};

function newSessionId(): string {
  return crypto.randomUUID();
}

function MarkdownText({ text, streaming, showCaret }: { text: string; streaming: boolean; showCaret: boolean }) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <pre className={styles.codeBlock}>{children}</pre>,
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className={styles.inlineCode}>{children}</code>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && showCaret ? <span className={styles.caret} aria-hidden /> : null}
    </div>
  );
}

function ToolPart({ part }: { part: { type: string; [key: string]: unknown } }) {
  const name = part.type.startsWith("tool-") ? part.type.slice(5) : part.type;
  const state = typeof part.state === "string" ? part.state : "running";
  const input = part.input ?? part.args;
  const output = part.output ?? part.result;

  let body = "…";
  if (state === "output-available" || state === "result") {
    body = JSON.stringify(input != null ? { input, output: output ?? null } : (output ?? {}), null, 2);
  } else if (input != null) {
    body = JSON.stringify(input, null, 2);
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

function MessageBubble({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const parts = message.parts ?? [];
  return (
    <article className={`${styles.bubble} ${styles[message.role === "user" ? "user" : "assistant"]}`}>
      <div className={styles.role}>{message.role === "user" ? "You" : "Agent"}</div>
      <div className={styles.parts}>
        {parts.map((part, i) => {
          if (part.type === "text") {
            const text = "text" in part ? String(part.text ?? "") : "";
            return (
              <MarkdownText
                key={`${message.id}-text-${i}`}
                text={text}
                streaming={streaming}
                showCaret={i === parts.length - 1}
              />
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

export function ChatShell({
  api,
  storageKey,
  title,
  badge,
  blurb,
  emptyTitle,
  emptyBody,
  suggestions,
  activeNav,
}: ChatShellProps) {
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const threadRef = useRef<HTMLElement | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api,
        prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages } }),
      }),
    [api],
  );

  const { messages, sendMessage, status, stop, error, clearError, setMessages } = useChat({
    id: sessionId || "pending",
    transport,
    throttle: 40,
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const id = window.localStorage.getItem(storageKey) ?? newSessionId();
    window.localStorage.setItem(storageKey, id);
    setSessionId(id);
    setSessionReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (sessionReady && sessionId) window.localStorage.setItem(storageKey, sessionId);
  }, [sessionReady, sessionId, storageKey]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
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
    window.localStorage.setItem(storageKey, next);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <div className={styles.brand}>
            <img src="/brand-icon.png" alt="SocialRobot" width={40} height={40} className={styles.logo} />
            <div className={styles.brandText}>
              <div className={styles.titleRow}>
                <h1>{title}</h1>
                <span className={styles.badge}>{badge}</span>
              </div>
              <a className={styles.byline} href="https://socialrobot.io" target="_blank" rel="noreferrer">
                By <strong>SocialRobot</strong>
              </a>
            </div>
          </div>
          <nav className={styles.nav} aria-label="Demo pages">
            <Link href="/" className={`${styles.navLink} ${activeNav === "chat" ? styles.navActive : ""}`}>
              Chat
            </Link>
            <Link
              href="/code-runner"
              className={`${styles.navLink} ${activeNav === "code-runner" ? styles.navActive : ""}`}
            >
              Code runner
            </Link>
          </nav>
        </div>
        <p>{blurb}</p>
        <div className={styles.meta}>
          <span className={`${styles.dot} ${busy ? styles.busy : styles.ok}`} aria-hidden />
          {busy ? (status === "streaming" ? "streaming" : "thinking") : "ready"}
          <button type="button" className={styles.ghostLink} onClick={onNewChat} disabled={busy}>
            New chat
          </button>
        </div>
      </header>

      <section ref={threadRef} className={styles.thread} aria-live="polite">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <h2>{emptyTitle}</h2>
            <p>{emptyBody}</p>
            <div className={styles.suggestions}>
              {suggestions.map((s) => (
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
              streaming={busy && message.role === "assistant" && index === messages.length - 1}
            />
          ))
        )}
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

      <footer className={styles.footer}>
        <img src="/brand-icon.png" alt="" width={17} height={17} className={styles.footerLogo} />
        <span>
          By{" "}
          <a href="https://socialrobot.io" target="_blank" rel="noreferrer">
            SocialRobot
          </a>
        </span>
      </footer>
    </main>
  );
}
