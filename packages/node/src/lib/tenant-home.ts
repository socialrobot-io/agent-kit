/**
 * Convention-over-configuration host home for one tenant.
 *
 * Default path: `${dataDir}/tenants/${tenantId}.db`
 * Default model: anthropic/claude-sonnet-4-5
 * Default tools: transcripts + session_search + sandbox
 *
 * Pass a compiled {@link AgentBundle} from `compileAgent`.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defineAgent,
  createAgentFs,
  installAgent,
  type AgentBundle,
  type AgentDefinition,
} from "@socialrobot-io/agent-kit-core";
import {
  openAgentSession,
  type AgentSession,
  type ModelInput,
  type OpenAgentSessionOptions,
  type ResolveModelOptions,
} from "@socialrobot-io/agent-kit-ai";
import {
  openTenantVolume,
  createTenantBashToolkit,
  type CreateTenantBashToolkitOptions,
  type TenantBashToolkit,
  type TenantVolume,
} from "@socialrobot-io/agent-kit-sandbox";
import {
  FileTranscriptStore,
  assertTenantSession,
  createSessionSearchTool,
  type TranscriptStore,
} from "@socialrobot-io/agent-kit-sessions";
import { FRAMEWORK_SKILLS } from "./framework-skills.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
const DEFAULT_DATA_DIR = "./data";

/** Process-local cache: one home per absolute/relative volume path. */
const homes = new Map<string, Promise<TenantHome>>();

export type CreateTenantHomeOptions = ResolveModelOptions & {
  /** Stable tenant id from your auth layer. Never from the client body alone. */
  tenantId: string;
  /**
   * Compiled agent (from {@link compileAgent}). Installed on the privileged
   * volume at boot. Required for a working SOUL/skills home.
   */
  agent?: AgentBundle;
  /**
   * Directory for tenant volumes. Convention: `${dataDir}/tenants/${tenantId}.db`.
   * Ignored when `volumePath` is set. Default `./data`.
   */
  dataDir?: string;
  /** Full path to the tenant SQLite file. Overrides `dataDir` convention. */
  volumePath?: string;
  /**
   * Agent definition. Default: `defineAgent({ model })` with
   * `model` defaulting to anthropic/claude-sonnet-4-5.
   */
  definition?: AgentDefinition;
  /** Model when `definition` is omitted. String id or ready LanguageModel. */
  model?: ModelInput;
  /** Create guarded bash tools on this volume. Default true. */
  sandbox?: boolean | Omit<CreateTenantBashToolkitOptions, "tenantId" | "volume" | "agentFs">;
  /** Persist transcripts + wire session_search. Default true. */
  transcripts?: boolean;
  /** Passed through to every `openSession` unless overridden there. */
  interactiveApproval?: OpenAgentSessionOptions["interactiveApproval"];
  /** Seed workspace files when sandbox is on. */
  workspaceFiles?: Record<string, string>;
};

export type OpenHomeSessionOptions = Omit<
  OpenAgentSessionOptions,
  "tenantId" | "fs" | "definition" | "sessionSearchTool" | "sandboxTools"
> & {
  /** Override home definition for this chat only. */
  definition?: AgentDefinition;
  /** Include session_search (requires transcripts). Default true when transcripts exist. */
  sessionSearch?: boolean;
  /** Include sandbox tools. Default true when bash was created. */
  sandbox?: boolean;
};

export interface TenantHome {
  tenantId: string;
  volumePath: string;
  volume: TenantVolume;
  definition: AgentDefinition;
  transcripts?: TranscriptStore;
  bash?: TenantBashToolkit;
  /**
   * Open (or re-open) a chat session. Creates the transcript row, asserts
   * tenant ownership, wires search + sandbox by convention.
   */
  openSession: (sessionId: string, opts?: OpenHomeSessionOptions) => Promise<AgentSession>;
}

function resolveVolumePath(opts: CreateTenantHomeOptions): string {
  if (opts.volumePath) return opts.volumePath;
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  return join(dataDir, "tenants", `${opts.tenantId}.db`);
}

function resolveDefinition(opts: CreateTenantHomeOptions): AgentDefinition {
  if (opts.definition) return opts.definition;
  const model =
    typeof opts.model === "string" || opts.model === undefined
      ? (opts.model ?? DEFAULT_MODEL)
      : DEFAULT_MODEL;
  return defineAgent({ model });
}

async function installEnvelope(volume: TenantVolume, agent?: AgentBundle): Promise<void> {
  if (agent) {
    await installAgent(volume, agent);
  }
  if (FRAMEWORK_SKILLS.length) {
    await installAgent(volume, {
      skills: FRAMEWORK_SKILLS.map((s) => ({ ...s, tier: "framework" as const })),
    });
  }
}

async function bootHome(opts: CreateTenantHomeOptions): Promise<TenantHome> {
  const tenantId = opts.tenantId;
  if (!tenantId.trim()) throw new Error("createTenantHome requires tenantId");

  const volumePath = resolveVolumePath(opts);
  await mkdir(dirname(volumePath), { recursive: true });

  const volume = await openTenantVolume(volumePath);
  const definition = resolveDefinition(opts);
  const agentFs = createAgentFs(volume);

  await installEnvelope(volume, opts.agent);

  const wantTranscripts = opts.transcripts !== false;
  const transcripts = wantTranscripts ? new FileTranscriptStore({ fs: volume }) : undefined;

  const sandboxOpt = opts.sandbox;
  const wantSandbox = sandboxOpt !== false;
  let bash: TenantBashToolkit | undefined;
  const sandboxSecrets =
    typeof sandboxOpt === "object" && sandboxOpt.secrets ? sandboxOpt.secrets : undefined;
  if (wantSandbox) {
    const extra = typeof sandboxOpt === "object" ? sandboxOpt : {};
    bash = await createTenantBashToolkit({
      tenantId,
      volume,
      destination: "/workspace",
      files: opts.workspaceFiles,
      ...extra,
    });
  }

  const resolveOpts: ResolveModelOptions = {
    gateway: opts.gateway,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
  };

  const openSession = async (
    sessionId: string,
    sessionOpts: OpenHomeSessionOptions = {},
  ): Promise<AgentSession> => {
    if (!sessionId.trim()) throw new Error("openSession requires sessionId");

    if (transcripts) {
      await transcripts.createSession({
        id: sessionId,
        tenantId,
        source: "chat",
        createdAt: Date.now() / 1000,
      });
      await assertTenantSession(transcripts, tenantId, sessionId);
    }

    const useSearch = sessionOpts.sessionSearch !== false && Boolean(transcripts);
    const useSandbox = sessionOpts.sandbox !== false && Boolean(bash);

    const {
      definition: sessionDefinition,
      sessionSearch: _searchFlag,
      sandbox: _sandboxFlag,
      model: sessionModel,
      interactiveApproval,
      ...rest
    } = sessionOpts;

    return openAgentSession({
      tenantId,
      fs: agentFs,
      definition: sessionDefinition ?? definition,
      model:
        sessionModel ??
        (typeof opts.model !== "string" && opts.model !== undefined ? opts.model : undefined),
      interactiveApproval: interactiveApproval ?? opts.interactiveApproval,
      secrets: sandboxSecrets,
      sessionSearchTool:
        useSearch && transcripts
          ? createSessionSearchTool(transcripts, tenantId, { currentSessionId: sessionId })
          : undefined,
      sandboxTools: useSandbox && bash ? bash.tools : undefined,
      ...resolveOpts,
      ...rest,
    });
  };

  return {
    tenantId,
    volumePath,
    volume,
    definition,
    transcripts,
    bash,
    openSession,
  };
}

/**
 * Open (or reuse) the process-local home for one tenant volume.
 *
 * ```ts
 * import { agent } from "./generated/agent";
 * const home = await createTenantHome({ tenantId, agent });
 * const session = await home.openSession(sessionId);
 * ```
 */
export async function createTenantHome(opts: CreateTenantHomeOptions): Promise<TenantHome> {
  const key = resolveVolumePath(opts);
  const existing = homes.get(key);
  if (existing) return existing;

  const boot = bootHome(opts);
  homes.set(key, boot);
  try {
    return await boot;
  } catch (err) {
    homes.delete(key);
    throw err;
  }
}

/** Clear the home cache (tests only). Does not close volumes. */
export function resetTenantHomeCache(): void {
  homes.clear();
}
