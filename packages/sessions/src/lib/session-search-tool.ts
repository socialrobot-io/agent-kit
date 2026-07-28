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

export interface CreateSessionSearchToolOptions {
  /** Active chat id. Excluded from browse/discovery; blocked for scroll by default. */
  currentSessionId?: string;
}

export function createSessionSearchTool(
  store: TranscriptStore,
  tenantId: string,
  opts: CreateSessionSearchToolOptions = {},
): SessionSearchTool {
  return {
    name: "session_search",
    description:
      "Search past conversation sessions. Returns messages from the transcript store — " +
      "no summarization.\n\n" +
      "BROWSE (no args): list past sessions for this tenant (newest first). The current " +
      "chat is skipped by default — it is already in context.\n" +
      "DISCOVERY (query): find matching messages across past sessions.\n" +
      "SCROLL (session_id): read a window within one past session. Do not scroll the " +
      "current session_id unless the user explicitly needs it (include_current=true).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for discovery mode." },
        session_id: { type: "string", description: "Session to scroll/browse." },
        offset: { type: "number", description: "Message offset for scroll mode." },
        limit: { type: "number", description: "Max messages/sessions to return (default 20)." },
        include_current: {
          type: "boolean",
          description:
            "Include the current chat in browse/discovery, or allow scrolling it. Default false.",
        },
      },
      required: [] as string[],
    },
    execute: async (args) =>
      sessionSearch(
        store,
        tenantId,
        {
          query: args.query as string | undefined,
          session_id: args.session_id as string | undefined,
          offset: args.offset as number | undefined,
          limit: args.limit as number | undefined,
          include_current: args.include_current as boolean | undefined,
        },
        { currentSessionId: opts.currentSessionId },
      ),
  };
}
