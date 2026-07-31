/**
 * Code-runner demo home: sandboxed js-exec on its own volume/tenant.
 */

import { defineAgent, type SessionTool } from "@socialrobot-io/agent-kit-core";
import { type AgentSession } from "@socialrobot-io/agent-kit-ai";
import { createTenantHome, type TenantHome } from "@socialrobot-io/agent-kit-node";
import type { TranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import type { LanguageModel, ToolSet } from "ai";
import type { TenantBashToolkit } from "@socialrobot-io/agent-kit-sandbox";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";
import { join } from "node:path";
import { agent } from "../generated/code-runner-agent";

export const CODE_RUNNER_TENANT_ID = "code-runner-demo";
export const CODE_RUNNER_AGENT_DIR = "agents/code-runner";

const allowUnapproved = process.env.ALLOW_UNAPPROVED_WRITES === "1";

type SharedState = {
  home: TenantHome;
  live: LiveModel;
  sessions: Map<string, AgentSession>;
};

declare global {
  // eslint-disable-next-line no-var
  var __agentKitCodeRunner: SharedState | undefined;
  // eslint-disable-next-line no-var
  var __agentKitCodeRunnerBoot: Promise<SharedState> | undefined;
}

const WORKSPACE_FILES: Record<string, string> = {
  "README.md":
    "# Code runner workspace\n\n" +
    "Use `js-exec` for calculations. Example:\n" +
    "`js-exec -c \"console.log(1+2)\"`\n" +
    "Write longer scripts with writeFile, then run them with js-exec.\n",
};

const MAX_SESSIONS = 32;

const serverTime: SessionTool = {
  name: "server_time",
  description: "Return the host server time as an ISO string.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ now: new Date().toISOString() }),
};

export type CodeRunnerHandle = {
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
  const volumePath = join(root, ".agentfs", "code-runner.db");

  const home = await createTenantHome({
    tenantId: CODE_RUNNER_TENANT_ID,
    volumePath,
    model: live.model,
    definition: defineAgent({
      model: live.label,
      config: {
        curator: false,
        writeApproval: allowUnapproved
          ? { memory: false, skills: false }
          : { memory: true, skills: true },
        sandboxEnabled: true,
      },
    }),
    interactiveApproval: !allowUnapproved,
    workspaceFiles: WORKSPACE_FILES,
    sandbox: {
      javascript: true,
    },
    agent,
  });

  return {
    home,
    live,
    sessions: new Map(),
  };
}

async function getShared(): Promise<SharedState> {
  if (globalThis.__agentKitCodeRunner) return globalThis.__agentKitCodeRunner;

  if (!globalThis.__agentKitCodeRunnerBoot) {
    globalThis.__agentKitCodeRunnerBoot = bootShared()
      .then((shared) => {
        globalThis.__agentKitCodeRunner = shared;
        return shared;
      })
      .catch((err) => {
        globalThis.__agentKitCodeRunnerBoot = undefined;
        throw err;
      });
  }

  return globalThis.__agentKitCodeRunnerBoot;
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

export async function getCodeRunnerSession(sessionId: string): Promise<CodeRunnerHandle> {
  if (!sessionId.trim()) {
    throw new Error("sessionId is required (memory freezes once per chat session).");
  }

  const shared = await getShared();
  const interactiveApproval = !allowUnapproved;
  let session = shared.sessions.get(sessionId);
  if (session && interactiveApproval && !session.writeToolApproval) {
    shared.sessions.delete(sessionId);
    session = undefined;
  }
  if (!session) {
    await seedAgentHome(shared.home.volume, CODE_RUNNER_AGENT_DIR);
    session = await shared.home.openSession(sessionId, {
      model: shared.live.model,
      interactiveApproval,
      addTools: [serverTime],
    });
  }

  touchSession(shared.sessions, sessionId, session);

  if (!shared.home.bash || !shared.home.transcripts) {
    throw new Error("code-runner home requires sandbox and transcripts");
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

export async function getCodeRunnerTranscripts(): Promise<TranscriptStore> {
  const shared = await getShared();
  if (!shared.home.transcripts) throw new Error("transcripts disabled");
  return shared.home.transcripts;
}

export async function getCodeRunnerShared(): Promise<{
  model: LanguageModel;
  label: string;
  provider: LiveModel["provider"];
  bash: TenantBashToolkit;
  transcripts: TranscriptStore;
  openSessions: string[];
  savedSessions: { id: string; createdAt: number; messageCount: number }[];
}> {
  const shared = await getShared();
  if (!shared.home.bash || !shared.home.transcripts) {
    throw new Error("code-runner home requires sandbox and transcripts");
  }
  const transcripts = shared.home.transcripts;
  const sessions = await transcripts.listSessions(CODE_RUNNER_TENANT_ID);
  const savedSessions = [];
  for (const s of sessions) {
    const msgs = await transcripts.scroll(s.id, 0, 10_000);
    savedSessions.push({ id: s.id, createdAt: s.createdAt, messageCount: msgs.length });
  }

  return {
    model: shared.live.model,
    label: shared.live.label,
    provider: shared.live.provider,
    bash: shared.home.bash,
    transcripts,
    openSessions: [...shared.sessions.keys()],
    savedSessions,
  };
}
