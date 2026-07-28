import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { streamAgentTurn } from "@agent-kit/ai";
import { assertTenantSession } from "@agent-kit/sessions";
import { getSessionAgent, getSharedAgent, getTranscripts, TENANT_ID } from "@/lib/agent";
import { persistUiMessages, transcriptToUiMessages } from "@/lib/transcripts";
import { hasApiKey } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  messages?: UIMessage[];
  /** Hermes chat session id — memory snapshot freezes once per id. */
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
      { error: "Missing chat session id. The client must send `id` (useChat) so memory can freeze per session." },
      { status: 400 },
    );
  }
  if (!messages.length) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  try {
    const agent = await getSessionAgent(sessionId);
    const { toolSet } = agent.session.composeTools();

    await persistUiMessages(agent.transcripts, sessionId, messages.filter((m) => m.role === "user"));

    const modelMessages = await convertToModelMessages(messages);
    const result = streamAgentTurn(modelMessages, {
      runtime: agent.session.runtime,
      model: agent.model,
      toolSet,
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
      headers: {
        "x-agent-kit-model": agent.label,
        "x-agent-kit-provider": agent.provider,
        "x-agent-kit-session": sessionId,
        "x-agent-kit-sandbox": "bash-tool",
        "x-agent-kit-transcripts": "agentfs",
      },
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/chat]", err);
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
      const transcripts = await getTranscripts();
      try {
        await assertTenantSession(transcripts, TENANT_ID, sessionId);
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

    const agent = await getSharedAgent();
    return NextResponse.json({
      ok: true,
      model: agent.label,
      provider: agent.provider,
      sandbox: true,
      tools: [
        "memory",
        "skills_list",
        "skill_view",
        "skill_manage",
        "session_search",
        "bash",
        "readFile",
        "writeFile",
      ],
      openSessions: agent.openSessions,
      savedSessions: agent.savedSessions,
      ...(agent.liveUserMemory
        ? { memoryOnDisk: { user: agent.liveUserMemory, notes: agent.liveNotesMemory } }
        : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
