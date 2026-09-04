import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { codeRunnerKit, CODE_RUNNER_TENANT_ID, serverTime } from "@/lib/code-runner-kit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages, id: sessionId } = (await req.json()) as {
    messages: UIMessage[];
    id: string; // useChat
  };

  const session = await codeRunnerKit.session(CODE_RUNNER_TENANT_ID, sessionId, {
    addTools: [serverTime],
  });
  const result = session.stream(await convertToModelMessages(messages));
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
