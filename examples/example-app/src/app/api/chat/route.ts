import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { chatKit, TENANT_ID } from "@/lib/kit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages, id: sessionId } = (await req.json()) as {
    messages: UIMessage[];
    id: string; // useChat
  };

  const session = await chatKit.session(TENANT_ID, sessionId);
  const result = session.stream(await convertToModelMessages(messages));
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
