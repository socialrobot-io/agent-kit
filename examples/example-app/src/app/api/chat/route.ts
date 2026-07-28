import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { streamAgentTurn } from "@agent-kit/ai";
import { getAgent } from "@/lib/agent";
import { hasApiKey } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  let messages: UIMessage[];
  try {
    const body = (await req.json()) as { messages?: UIMessage[] };
    messages = body.messages ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!messages.length) {
    return NextResponse.json({ error: "Send at least one message." }, { status: 400 });
  }

  try {
    const agent = await getAgent();
    const modelMessages = await convertToModelMessages(messages);
    const result = streamAgentTurn(modelMessages, {
      runtime: agent.runtime,
      model: agent.model,
      extraAiTools: agent.bashTools,
      maxSteps: 12,
    });

    return createUIMessageStreamResponse({
      headers: {
        "x-agent-kit-model": agent.label,
        "x-agent-kit-provider": agent.provider,
        "x-agent-kit-sandbox": "bash-tool",
      },
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/chat]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  if (!hasApiKey()) {
    return NextResponse.json({
      ok: false,
      error: "Missing DEEPSEEK_API_KEY or AI_GATEWAY_API_KEY",
    });
  }
  try {
    const agent = await getAgent();
    return NextResponse.json({
      ok: true,
      model: agent.label,
      provider: agent.provider,
      sandbox: true,
      tools: ["memory", "skills_list", "skill_view", "skill_manage", "bash", "readFile", "writeFile"],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
