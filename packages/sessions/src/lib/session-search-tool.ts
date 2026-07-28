/**
 * Build the session_search tool for a transcript store.
 * Returns a structural SessionTool (compatible with @socialrobot-io/agent-kit-core).
 */

import { sessionSearch, type TranscriptStore } from "./transcript.js";

/** Structural match for @socialrobot-io/agent-kit-core SessionTool — kept local so sessions stays a leaf. */
export interface SessionSearchTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export function createSessionSearchTool(
  store: TranscriptStore,
  tenantId: string,
): SessionSearchTool {
  return {
    name: "session_search",
    description:
      "Search past conversation sessions. Returns messages from the transcript store — " +
      "no summarization. Use discovery mode (query) to find sessions, or session_id to scroll.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for discovery mode." },
        session_id: { type: "string", description: "Session to scroll/browse." },
        offset: { type: "number", description: "Message offset for scroll mode." },
        limit: { type: "number", description: "Max messages to return (default 20)." },
      },
      required: [] as string[],
    },
    execute: async (args) =>
      sessionSearch(store, tenantId, {
        query: args.query as string | undefined,
        session_id: args.session_id as string | undefined,
        offset: args.offset as number | undefined,
        limit: args.limit as number | undefined,
      }),
  };
}
