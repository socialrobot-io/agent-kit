/**
 * Process-wide AgentFS + bash toolkit + durable chat transcripts.
 *
 * Hermes loads MEMORY.md / USER.md once at session start and freezes them into
 * the system prompt for the whole conversation so the LLM prefix cache stays
 * warm. Mid-session memory writes hit disk immediately but do NOT change the
 * prompt until the *next* session starts.
 *
 * Mapping that onto Next.js + useChat:
 *  - Shared: AgentFS volume, model, bash toolkit, FileTranscriptStore
 *  - Per chat `sessionId`: one AgentSessionRuntime, init() once → frozen snapshot
 *  - "New chat" = new sessionId = new runtime.init() = fresh snapshot from disk
 *  - Chat turns append to `sessions/*.jsonl` in the same AgentFS volume
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { AgentFS } from "agentfs-sdk";
import {
  AgentSessionRuntime,
  defineAgent,
  MemoryStore,
  SESSION_SEARCH_SCHEMA,
  type SessionTool,
} from "@agent-kit/core";
import { createTenantBashToolkit, type TenantBashToolkit } from "@agent-kit/sandbox";
import {
  FileTranscriptStore,
  sessionSearch,
  type TranscriptStore,
} from "@agent-kit/sessions";
import type { LanguageModel } from "ai";
import { adaptAgentFs, serializeAgentFs, type AgentFsAdapter } from "./fs-adapter";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";

export const TENANT_ID = "demo-user";

type SharedState = {
  afs: AgentFS;
  fs: AgentFsAdapter;
  live: LiveModel;
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  /** chat sessionId → runtime with a frozen memory snapshot */
  sessions: Map<string, AgentSessionRuntime>;
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

/** Bound open chat sessions so a long-lived Next process cannot leak forever. */
const MAX_SESSIONS = 32;

export type AgentHandle = {
  sessionId: string;
  runtime: AgentSessionRuntime;
  model: LanguageModel;
  label: string;
  provider: LiveModel["provider"];
  bashTools: ToolSet;
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  extraTools: SessionTool[];
};

function isLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /lock|busy/i.test(msg);
}

/**
 * AgentFS/Turso holds an exclusive file lock. Concurrent AgentFS.open() on the
 * same path fails with "database is locked" — common when the UI fires health +
 * history GETs together on cold start. Serialize boot and retry briefly.
 */
async function openAgentFs(volumePath: string): Promise<AgentFS> {
  let last: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await AgentFS.open({ path: volumePath });
    } catch (err) {
      last = err;
      if (!isLockError(err) || attempt === 7) throw err;
      await new Promise((r) => setTimeout(r, 40 * 2 ** attempt));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function bootShared(): Promise<SharedState> {
  const live = resolveLiveModel();
  const root = await examplePackageRoot();
  const volumeDir = join(root, ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });

  const afs = await openAgentFs(volumePath);
  // One queue for adapter + AgentFsWrapper (bash) sharing this volume.
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

  return {
    afs,
    fs,
    live,
    bash,
    transcripts,
    sessions: new Map(),
  };
}

async function getShared(): Promise<SharedState> {
  if (globalThis.__agentKitExample) return globalThis.__agentKitExample;

  // Single-flight: parallel first requests must share one open(), not race it.
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

function touchSession(sessions: Map<string, AgentSessionRuntime>, sessionId: string, runtime: AgentSessionRuntime) {
  sessions.delete(sessionId);
  sessions.set(sessionId, runtime);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

function makeSessionSearchTool(transcripts: TranscriptStore): SessionTool {
  return {
    name: SESSION_SEARCH_SCHEMA.name,
    description: SESSION_SEARCH_SCHEMA.description,
    inputSchema: { ...SESSION_SEARCH_SCHEMA.inputSchema },
    execute: async (args) =>
      sessionSearch(transcripts, TENANT_ID, {
        query: args.query as string | undefined,
        session_id: args.session_id as string | undefined,
        offset: args.offset as number | undefined,
        limit: args.limit as number | undefined,
      }),
  };
}

/**
 * Return the agent bound to this chat session.
 * First call for a sessionId runs `init()` and freezes the memory snapshot
 * (Hermes session start). Later turns reuse that same frozen prompt prefix.
 */
export async function getSessionAgent(sessionId: string): Promise<AgentHandle> {
  if (!sessionId.trim()) {
    throw new Error("sessionId is required (Hermes freezes memory per chat session).");
  }

  const shared = await getShared();
  let runtime = shared.sessions.get(sessionId);
  if (!runtime) {
    await seedAgentHome(shared.fs);

    const definition = defineAgent({
      model: shared.live.label,
      config: {
        writeApproval: { memory: false, skills: false },
        sandboxEnabled: true,
      },
    });

    runtime = new AgentSessionRuntime({
      tenantId: TENANT_ID,
      fs: shared.fs,
      definition,
      origin: "foreground",
    });
    await runtime.init();

    await shared.transcripts.createSession({
      id: sessionId,
      tenantId: TENANT_ID,
      source: "composer",
      createdAt: Date.now() / 1000,
    });
  }

  touchSession(shared.sessions, sessionId, runtime);

  return {
    sessionId,
    runtime,
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bashTools: shared.bash.tools as unknown as ToolSet,
    bash: shared.bash,
    transcripts: shared.transcripts,
    extraTools: [makeSessionSearchTool(shared.transcripts)],
  };
}

export async function getTranscripts(): Promise<TranscriptStore> {
  const shared = await getShared();
  return shared.transcripts;
}

/** Shared handle without opening a chat session (health / debug). */
export async function getSharedAgent(): Promise<Omit<AgentHandle, "sessionId" | "runtime" | "extraTools"> & {
  openSessions: string[];
  liveUserMemory: string[];
  liveNotesMemory: string[];
  savedSessions: { id: string; createdAt: number; messageCount: number }[];
}> {
  const shared = await getShared();
  const mem = new MemoryStore(shared.fs);
  await mem.loadFromDisk();
  const sessions = await shared.transcripts.listSessions(TENANT_ID);
  const savedSessions = [];
  for (const s of sessions) {
    const msgs = await shared.transcripts.scroll(s.id, 0, 10_000);
    savedSessions.push({ id: s.id, createdAt: s.createdAt, messageCount: msgs.length });
  }
  return {
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bashTools: shared.bash.tools as unknown as ToolSet,
    bash: shared.bash,
    transcripts: shared.transcripts,
    openSessions: [...shared.sessions.keys()],
    liveUserMemory: mem.getEntries("user"),
    liveNotesMemory: mem.getEntries("memory"),
    savedSessions,
  };
}
