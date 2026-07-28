/**
 * Process-wide tenant home + per-chat sessions.
 *
 * Host pattern: auth → tenantId → createTenantHome → openSession(sessionId)
 */

import { defineAgent, MemoryStore, type SessionTool } from "@socialrobot-io/agent-kit-core";
import { type AgentSession } from "@socialrobot-io/agent-kit-ai";
import { createTenantHome, type TenantHome } from "@socialrobot-io/agent-kit-node";
import type { TranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import type { LanguageModel, ToolSet } from "ai";
import type { TenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";
import { join } from "node:path";

export const TENANT_ID = "demo-user";

/** Opt out of write approval for local demos: ALLOW_UNAPPROVED_WRITES=1 */
const allowUnapproved = process.env.ALLOW_UNAPPROVED_WRITES === "1";

type SharedState = {
  home: TenantHome;
  live: LiveModel;
  /** chat sessionId → session */
  sessions: Map<string, AgentSession>;
};

declare global {
  // eslint-disable-next-line no-var
  var __agentKitExample: SharedState | undefined;
  // eslint-disable-next-line no-var
  var __agentKitExampleBoot: Promise<SharedState> | undefined;
}

const WORKSPACE_FILES: Record<string, string> = {
  "README.md":
    "# Sandbox workspace\n\nPersisted in the tenant AgentFS SQLite volume " +
    "(`.agentfs/example.db`) via agentfs-sdk/just-bash.\n" +
    "Try: `ls`, `cat README.md`, or write a short note with writeFile.\n",
  "notes/todo.txt": "- try bash\n- ask the agent to summarize this file\n",
};

const MAX_SESSIONS = 32;

export type AgentHandle = {
  sessionId: string;
  session: AgentSession;
  model: LanguageModel;
  label: string;
  provider: LiveModel["provider"];
  bashTools: ToolSet;
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  builtinTools: SessionTool[];
};

async function bootShared(): Promise<SharedState> {
  const live = resolveLiveModel();
  const root = await examplePackageRoot();
  const volumePath = join(root, ".agentfs", "example.db");

  const home = await createTenantHome({
    tenantId: TENANT_ID,
    volumePath,
    model: live.model,
    definition: defineAgent({
      model: live.label,
      config: {
        writeApproval: allowUnapproved
          ? { memory: false, skills: false }
          : { memory: true, skills: true },
        sandboxEnabled: true,
      },
    }),
    // Chat UI Approve/Deny for memory/skill writes (pairs toolApproval + apply).
    interactiveApproval: !allowUnapproved,
    workspaceFiles: WORKSPACE_FILES,
  });
  await seedAgentHome(home.volume);

  return {
    home,
    live,
    sessions: new Map(),
  };
}

async function getShared(): Promise<SharedState> {
  if (globalThis.__agentKitExample) return globalThis.__agentKitExample;

  if (!globalThis.__agentKitExampleBoot) {
    globalThis.__agentKitExampleBoot = bootShared()
      .then((shared) => {
        globalThis.__agentKitExample = shared;
        return shared;
      })
      .catch((err) => {
        globalThis.__agentKitExampleBoot = undefined;
        throw err;
      });
  }

  return globalThis.__agentKitExampleBoot;
}

function touchSession(sessions: Map<string, AgentSession>, sessionId: string, session: AgentSession) {
  sessions.delete(sessionId);
  sessions.set(sessionId, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

/**
 * Return the agent bound to this chat session (frozen memory via openSession).
 */
export async function getSessionAgent(sessionId: string): Promise<AgentHandle> {
  if (!sessionId.trim()) {
    throw new Error("sessionId is required (memory freezes once per chat session).");
  }

  const shared = await getShared();
  const interactiveApproval = !allowUnapproved;
  let session = shared.sessions.get(sessionId);
  // Drop stale sessions from before interactiveApproval was wired (Next HMR / hot boot).
  if (session && interactiveApproval && !session.writeToolApproval) {
    shared.sessions.delete(sessionId);
    session = undefined;
  }
  if (!session) {
    await seedAgentHome(shared.home.volume);
    session = await shared.home.openSession(sessionId, {
      model: shared.live.model,
      interactiveApproval,
    });
  }

  touchSession(shared.sessions, sessionId, session);

  if (!shared.home.bash || !shared.home.transcripts) {
    throw new Error("example home requires sandbox and transcripts");
  }

  return {
    sessionId,
    session,
    model: session.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bashTools: shared.home.bash.tools as unknown as ToolSet,
    bash: shared.home.bash,
    transcripts: shared.home.transcripts,
    builtinTools: session.builtinTools,
  };
}

export async function getTranscripts(): Promise<TranscriptStore> {
  const shared = await getShared();
  if (!shared.home.transcripts) throw new Error("transcripts disabled");
  return shared.home.transcripts;
}

/** Shared handle without opening a chat session (health / debug). */
export async function getSharedAgent(): Promise<{
  model: LanguageModel;
  label: string;
  provider: LiveModel["provider"];
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  openSessions: string[];
  savedSessions: { id: string; createdAt: number; messageCount: number }[];
  liveUserMemory?: string[];
  liveNotesMemory?: string[];
}> {
  const shared = await getShared();
  if (!shared.home.bash || !shared.home.transcripts) {
    throw new Error("example home requires sandbox and transcripts");
  }
  const transcripts = shared.home.transcripts;
  const sessions = await transcripts.listSessions(TENANT_ID);
  const savedSessions = [];
  for (const s of sessions) {
    const msgs = await transcripts.scroll(s.id, 0, 10_000);
    savedSessions.push({ id: s.id, createdAt: s.createdAt, messageCount: msgs.length });
  }

  const debug = process.env.AGENT_KIT_DEBUG === "1";
  let liveUserMemory: string[] | undefined;
  let liveNotesMemory: string[] | undefined;
  if (debug) {
    const mem = new MemoryStore(shared.home.volume);
    await mem.loadFromDisk();
    liveUserMemory = mem.getEntries("user");
    liveNotesMemory = mem.getEntries("memory");
  }

  return {
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bash: shared.home.bash,
    transcripts,
    openSessions: [...shared.sessions.keys()],
    savedSessions,
    liveUserMemory,
    liveNotesMemory,
  };
}
