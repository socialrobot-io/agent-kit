/**
 * Process-wide AgentFS + bash toolkit, with Hermes-style per-chat sessions.
 *
 * Hermes loads MEMORY.md / USER.md once at session start and freezes them into
 * the system prompt for the whole conversation so the LLM prefix cache stays
 * warm. Mid-session memory writes hit disk immediately but do NOT change the
 * prompt until the *next* session starts.
 *
 * Mapping that onto Next.js + useChat:
 *  - Shared: AgentFS volume, model, bash toolkit (process singleton)
 *  - Per chat `sessionId`: one AgentSessionRuntime, init() once → frozen snapshot
 *  - "New chat" = new sessionId = new runtime.init() = fresh snapshot from disk
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { AgentFS } from "agentfs-sdk";
import { AgentSessionRuntime, defineAgent, MemoryStore } from "@agent-kit/core";
import { createTenantBashToolkit, type TenantBashToolkit } from "@agent-kit/sandbox";
import type { LanguageModel } from "ai";
import { adaptAgentFs, type AgentFsAdapter } from "./fs-adapter";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";

type SharedState = {
  afs: AgentFS;
  fs: AgentFsAdapter;
  live: LiveModel;
  bash: TenantBashToolkit;
  /** chat sessionId → runtime with a frozen memory snapshot */
  sessions: Map<string, AgentSessionRuntime>;
};

declare global {
  // eslint-disable-next-line no-var
  var __agentKitExample: SharedState | undefined;
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
};

async function getShared(): Promise<SharedState> {
  if (globalThis.__agentKitExample) return globalThis.__agentKitExample;

  const live = resolveLiveModel();
  const root = await examplePackageRoot();
  const volumeDir = join(root, ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });

  const afs = await AgentFS.open({ path: volumePath });
  const fs = adaptAgentFs(afs.fs);
  await seedAgentHome(fs);

  const bash = await createTenantBashToolkit({
    tenantId: "demo-user",
    agentFs: afs,
    files: WORKSPACE_FILES,
    destination: "/workspace",
  });

  const shared: SharedState = {
    afs,
    fs,
    live,
    bash,
    sessions: new Map(),
  };
  globalThis.__agentKitExample = shared;
  return shared;
}

function touchSession(sessions: Map<string, AgentSessionRuntime>, sessionId: string, runtime: AgentSessionRuntime) {
  // Re-insert so insertion order acts as a cheap LRU for eviction.
  sessions.delete(sessionId);
  sessions.set(sessionId, runtime);
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
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
    // Seed house rules only when opening a new session (not every turn).
    await seedAgentHome(shared.fs);

    const definition = defineAgent({
      model: shared.live.label,
      config: {
        writeApproval: { memory: false, skills: false },
        sandboxEnabled: true,
      },
    });

    runtime = new AgentSessionRuntime({
      tenantId: "demo-user",
      fs: shared.fs,
      definition,
      origin: "foreground",
    });
    await runtime.init();
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
  };
}

/** Shared handle without opening a chat session (health / debug). */
export async function getSharedAgent(): Promise<Omit<AgentHandle, "sessionId" | "runtime"> & {
  openSessions: string[];
  liveUserMemory: string[];
  liveNotesMemory: string[];
}> {
  const shared = await getShared();
  const mem = new MemoryStore(shared.fs);
  await mem.loadFromDisk();
  return {
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bashTools: shared.bash.tools as unknown as ToolSet,
    bash: shared.bash,
    openSessions: [...shared.sessions.keys()],
    liveUserMemory: mem.getEntries("user"),
    liveNotesMemory: mem.getEntries("memory"),
  };
}
