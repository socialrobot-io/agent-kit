/**
 * Process-wide AgentFS + bash toolkit + durable chat transcripts.
 *
 * Host pattern (see docs/guides/hosting.md):
 *   auth → tenantId → local volume path → openAgentFs + serializeAgentFs
 * Multi-machine is deferred: docs/roadmap/multi-machine.md
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSet } from "ai";
import type { AgentFS } from "agentfs-sdk";
import { defineAgent, MemoryStore, type SessionTool } from "@agent-kit/core";
import { openAgentSession, type AgentSessionHandle } from "@agent-kit/ai";
import {
  createTenantBashToolkit,
  openAgentFs,
  serializeAgentFs,
  type TenantBashToolkit,
} from "@agent-kit/sandbox";
import {
  FileTranscriptStore,
  createSessionSearchTool,
  type TranscriptStore,
} from "@agent-kit/sessions";
import type { LanguageModel } from "ai";
import { adaptAgentFs, type AgentFsAdapter } from "./fs-adapter";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";

export const TENANT_ID = "demo-user";

/** Opt out of write approval for local demos: ALLOW_UNAPPROVED_WRITES=1 */
const allowUnapproved = process.env.ALLOW_UNAPPROVED_WRITES === "1";

type SharedState = {
  afs: AgentFS;
  fs: AgentFsAdapter;
  live: LiveModel;
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  sessionSearchTool: SessionTool;
  /** chat sessionId → composed session handle */
  sessions: Map<string, AgentSessionHandle>;
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
  session: AgentSessionHandle;
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
  const volumeDir = join(root, ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });

  // Host would set tenantId from auth and open that tenant's volume path.
  const afs = await openAgentFs(volumePath);
  serializeAgentFs(afs.fs);
  const fs = adaptAgentFs(afs.fs);
  await seedAgentHome(fs);

  const bash = await createTenantBashToolkit({
    tenantId: TENANT_ID,
    agentFs: afs,
    files: WORKSPACE_FILES,
    destination: "/workspace",
  });

  const transcripts = new FileTranscriptStore({ fs });
  const sessionSearchTool = createSessionSearchTool(transcripts, TENANT_ID) as SessionTool;

  return {
    afs,
    fs,
    live,
    bash,
    transcripts,
    sessionSearchTool,
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

function touchSession(sessions: Map<string, AgentSessionHandle>, sessionId: string, handle: AgentSessionHandle) {
  sessions.delete(sessionId);
  sessions.set(sessionId, handle);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

/**
 * Return the agent bound to this chat session (frozen memory via openAgentSession).
 */
export async function getSessionAgent(sessionId: string): Promise<AgentHandle> {
  if (!sessionId.trim()) {
    throw new Error("sessionId is required (memory freezes once per chat session).");
  }

  const shared = await getShared();
  let session = shared.sessions.get(sessionId);
  if (!session) {
    await seedAgentHome(shared.fs);

    const definition = defineAgent({
      model: shared.live.label,
      config: {
        writeApproval: allowUnapproved
          ? { memory: false, skills: false }
          : { memory: true, skills: true },
        sandboxEnabled: true,
      },
    });

    session = await openAgentSession({
      tenantId: TENANT_ID,
      fs: shared.fs,
      definition,
      sessionSearchTool: shared.sessionSearchTool,
      sandboxTools: shared.bash.tools as unknown as ToolSet,
    });

    await shared.transcripts.createSession({
      id: sessionId,
      tenantId: TENANT_ID,
      source: "composer",
      createdAt: Date.now() / 1000,
    });
  }

  touchSession(shared.sessions, sessionId, session);

  return {
    sessionId,
    session,
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bashTools: shared.bash.tools as unknown as ToolSet,
    bash: shared.bash,
    transcripts: shared.transcripts,
    builtinTools: session.builtinTools,
  };
}

export async function getTranscripts(): Promise<TranscriptStore> {
  const shared = await getShared();
  return shared.transcripts;
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
  const sessions = await shared.transcripts.listSessions(TENANT_ID);
  const savedSessions = [];
  for (const s of sessions) {
    const msgs = await shared.transcripts.scroll(s.id, 0, 10_000);
    savedSessions.push({ id: s.id, createdAt: s.createdAt, messageCount: msgs.length });
  }

  const debug = process.env.AGENT_KIT_DEBUG === "1";
  let liveUserMemory: string[] | undefined;
  let liveNotesMemory: string[] | undefined;
  if (debug) {
    const mem = new MemoryStore(shared.fs);
    await mem.loadFromDisk();
    liveUserMemory = mem.getEntries("user");
    liveNotesMemory = mem.getEntries("memory");
  }

  return {
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bash: shared.bash,
    transcripts: shared.transcripts,
    openSessions: [...shared.sessions.keys()],
    savedSessions,
    liveUserMemory,
    liveNotesMemory,
  };
}
