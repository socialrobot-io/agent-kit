import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { assertTenantSession } from "@socialrobot-io/agent-kit-sessions";
import {
  CODE_RUNNER_TENANT_ID,
  getCodeRunnerSession,
  getCodeRunnerShared,
  getCodeRunnerTranscripts,
} from "@/lib/code-runner-agent";
import { persistUiMessages, transcriptToUiMessages } from "@/lib/transcripts";
import { hasApiKey } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  messages?: UIMessage[];
  id?: string;
  sessionId?: string;
};

export async function POST(req: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          "Missing API key. Copy .env.sample to .env.local and set DEEPSEEK_API_KEY (or AI_GATEWAY_API_KEY).",
      },
      { status: 500 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = body.messages ?? [];
  const sessionId = (body.sessionId ?? body.id ?? "").trim();
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing chat session id. The client must send `id` (useChat)." },
      { status: 400 },
    );
  }
  if (!messages.length) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  try {
    const agent = await getCodeRunnerSession(sessionId);

    await persistUiMessages(
      agent.transcripts,
      sessionId,
      messages.filter((m) => m.role === "user"),
      CODE_RUNNER_TENANT_ID,
    );

    const modelMessages = await convertToModelMessages(messages);
    const result = agent.session.stream(modelMessages, {
      maxSteps: 12,
      onFinish: async ({ text }) => {
        const assistantId = `asst_${sessionId}_${Date.now()}`;
        await agent.transcripts.appendMessage({
          id: assistantId,
          sessionId,
          role: "assistant",
          content: text || "(no text)",
          createdAt: Date.now() / 1000,
        });
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
      headers: {
        "x-agent-kit-model": agent.label,
        "x-agent-kit-provider": agent.provider,
        "x-agent-kit-session": sessionId,
        "x-agent-kit-sandbox": "js-exec",
        "x-agent-kit-transcripts": "agentfs",
        "x-agent-kit-interactive-approval": agent.session.writeToolApproval ? "1" : "0",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/code-runner/chat]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!hasApiKey()) {
    return NextResponse.json({
      ok: false,
      error: "Missing DEEPSEEK_API_KEY or AI_GATEWAY_API_KEY",
    });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId")?.trim();

  try {
    if (sessionId) {
      const transcripts = await getCodeRunnerTranscripts();
      try {
        await assertTenantSession(transcripts, CODE_RUNNER_TENANT_ID, sessionId);
      } catch {
        return NextResponse.json({ ok: true, sessionId, messages: [] });
      }
      const stored = await transcripts.scroll(sessionId, 0, 10_000);
      return NextResponse.json({
        ok: true,
        sessionId,
        messages: transcriptToUiMessages(stored),
      });
    }

    const agent = await getCodeRunnerShared();
    return NextResponse.json({
      ok: true,
      model: agent.label,
      provider: agent.provider,
      sandbox: true,
      javascript: true,
      interactiveApproval: process.env.ALLOW_UNAPPROVED_WRITES !== "1",
      tools: [
        "memory",
        "skills_list",
        "skill_view",
        "skill_manage",
        "session_search",
        "bash",
        "readFile",
        "writeFile",
        "server_time",
      ],
      openSessions: agent.openSessions,
      savedSessions: agent.savedSessions,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
