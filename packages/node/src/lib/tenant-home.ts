/**
 * Convention-over-configuration host home for one tenant.
 *
 * Default storage: one AgentFS file at `${dataDir}/tenants/${tenantId}.db`.
 * Pass `storage` for another backend (for example
 * `@socialrobot-io/agent-kit-node/postgres`).
 * Default model: anthropic/claude-sonnet-4-5
 * Default tools: transcripts + session_search + sandbox
 *
 * Pass a compiled {@link AgentBundle} from `compileAgent`.
 */

import {
  defineAgent,
  createAgentFs,
  installAgent,
  AgentSessionRuntime,
  type MemoryStore,
  type SkillLibrary,
  type PendingWriteStore,
  type AgentBundle,
  type AgentDefinition,
  type AgentFsLike,
} from "@socialrobot-io/agent-kit-core";
import {
  openAgentSession,
  type AgentSession,
  type ModelInput,
  type OpenAgentSessionOptions,
  type ResolveModelOptions,
} from "@socialrobot-io/agent-kit-ai";
import type { CuratorModelRunner, CuratorOutcome } from "@socialrobot-io/agent-kit-curator";
import type {
  CreateTenantBashToolkitOptions,
  TenantBashToolkit,
} from "@socialrobot-io/agent-kit-sandbox";
import {
  FileTranscriptStore,
  assertTenantSession,
  createSessionSearchTool,
  type TranscriptStore,
} from "@socialrobot-io/agent-kit-sessions";
import { FRAMEWORK_SKILLS } from "./framework-skills.js";
import {
  attachSessionCurator,
  parseCuratorJob,
  resolveCuratorRunner,
  reviewConversation,
  type CuratorJob,
  type CuratorQueue,
} from "./session-curator.js";
import {
  agentFsStorage,
  loadSandbox,
  type StorageAdapter,
  type StorageVolume,
  type TenantStorage,
} from "./storage.js";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-5";
const DEFAULT_DATA_DIR = "./data";

/** Storage opened once per key in this process, with its file transcript store. */
interface SharedStorage {
  opened: TenantStorage;
  /** FileTranscriptStore on the volume, when the storage has no transcript store. */
  fileTranscripts?: FileTranscriptStore;
}

/**
 * Process-local storage cache, one entry per storage key (the volume path for
 * AgentFS). Every home on a key shares it: AgentFS allows one open per file,
 * and file transcripts keep an index in memory.
 */
const storages = new Map<string, { tenantId: string; shared: Promise<SharedStorage> }>();

/** Process-local cache for createTenantHome: one home per storage key. */
const homes = new Map<string, Promise<TenantHome>>();

/** Open (or reuse) the storage for a tenant. Throws when another tenant holds the key. */
function openSharedStorage(storage: StorageAdapter, tenantId: string): Promise<SharedStorage> {
  const key = storage.key(tenantId);
  const existing = storages.get(key);
  if (existing) {
    // Tenant isolation: one storage key (for AgentFS, one file) per tenant.
    if (existing.tenantId !== tenantId) {
      throw new Error(
        `Storage '${key}' is already open for tenant '${existing.tenantId}'. ` +
          "Each tenant needs its own volume.",
      );
    }
    return existing.shared;
  }
  const shared = storage.open(tenantId).then((opened) => ({ opened }) as SharedStorage);
  storages.set(key, { tenantId, shared });
  shared.catch(() => storages.delete(key));
  return shared;
}

export type CreateTenantHomeOptions = ResolveModelOptions & {
  /** Stable tenant id from your auth layer. Never from the client body alone. */
  tenantId: string;
  /**
   * Compiled agent (from {@link compileAgent}). Installed on the privileged
   * volume at boot. Required for a working SOUL/skills home.
   */
  agent?: AgentBundle;
  /**
   * Storage backend for tenant state. Default: {@link agentFsStorage} (one
   * AgentFS SQLite file per tenant). Do not combine with `dataDir` or
   * `volumePath`.
   */
  storage?: StorageAdapter;
  /**
   * Directory for AgentFS tenant volumes. Convention:
   * `${dataDir}/tenants/${tenantId}.db`. Ignored when `volumePath` is set.
   * Default `./data`.
   */
  dataDir?: string;
  /**
   * Full path to one AgentFS file. Single-tenant only: a second tenant on the
   * same path throws. Overrides the `dataDir` convention.
   */
  volumePath?: string;
  /**
   * Agent definition. Default: `defineAgent({ model })` with
   * `model` defaulting to anthropic/claude-sonnet-4-5.
   */
  definition?: AgentDefinition;
  /** Model when `definition` is omitted. String id or ready LanguageModel. */
  model?: ModelInput;
  /**
   * Create guarded bash tools on this home. Default true. `/workspace`
   * persists only when the storage has an AgentFS handle; otherwise it lives
   * in process memory.
   */
  sandbox?: boolean | Omit<CreateTenantBashToolkitOptions, "tenantId" | "volume" | "agentFs">;
  /** Persist transcripts + wire session_search. Default true. */
  transcripts?: boolean;
  /** Passed through to every `openSession` unless overridden there. */
  interactiveApproval?: OpenAgentSessionOptions["interactiveApproval"];
  /** Seed workspace files when sandbox is on. */
  workspaceFiles?: Record<string, string>;
  /**
   * Override the curator model runner. Default: `aiCuratorRunner` on the
   * session model. Useful for tests or a custom review loop.
   */
  curatorRunner?: CuratorModelRunner;
  /**
   * Model for curator reviews (for example a cheaper model). Default: the
   * session model. Ignored when `curatorRunner` is set.
   */
  curatorModel?: ModelInput;
  /**
   * Hand curator reviews to your job queue instead of running them in this
   * process. The kit calls it once per completed turn with a
   * JSON-serializable {@link CuratorJob}. Run the job in a worker that opens
   * the same storage, with `home.review(job)` or `kit.review(job)`.
   */
  curatorQueue?: CuratorQueue;
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

/** Memory, skills, and pending writes for host code (settings pages, review UIs). */
export interface HomeStores {
  /** Curated MEMORY.md / USER.md, loaded from storage. */
  memory: MemoryStore;
  /** Skill library. */
  skills: SkillLibrary;
  /** Staged writes waiting for approval. */
  pending: PendingWriteStore;
}

/** Per-tenant home: volume, optional transcripts/sandbox, and session open. */
export interface TenantHome {
  /** Stable tenant id this home was opened for. */
  tenantId: string;
  /** Where the tenant data lives: a file path or a backend label. */
  location: string;
  /** @deprecated Use `location`. Same value. */
  volumePath: string;
  /**
   * Privileged agent-home filesystem (agent files, memory, skills, pending,
   * and AgentFS workspace). Host seed and deploy code only. Do not give it to
   * agent tools.
   */
  volume: StorageVolume;
  /** AgentFS handle when the storage is an AgentFS volume. */
  agentFs?: TenantStorage["agentFs"];
  /** Default agent definition for sessions from this home. */
  definition: AgentDefinition;
  /** Transcript store when `transcripts` was not disabled at home creation. */
  transcripts?: TranscriptStore;
  /** Guarded bash toolkit when sandbox was not disabled at home creation. */
  bash?: TenantBashToolkit;
  /**
   * Open (or re-open) a chat session. Creates the transcript row, asserts
   * tenant ownership, wires search + sandbox by convention.
   *
   * @param sessionId - Chat id. Memory freezes for this opened session handle.
   * @param opts - Per-chat overrides (model, tools, approval, …).
   */
  openSession: (sessionId: string, opts?: OpenHomeSessionOptions) => Promise<AgentSession>;
  /**
   * Fresh memory, skill, and pending stores for host code, with memory
   * loaded from storage. Writes go through the same policy view and lock as
   * sessions.
   */
  stores: () => Promise<HomeStores>;
  /**
   * Run one curator review now, with this home's agent policy. Use it in a
   * worker for jobs from `curatorQueue`, or for host events such as "the
   * user edited a draft". The job must belong to this tenant.
   *
   * @returns The review outcome, or `null` when the curator is disabled.
   */
  review: (job: CuratorJob) => Promise<CuratorOutcome | null>;
}

function legacyStorage(opts: CreateTenantHomeOptions): StorageAdapter {
  const fixedPath = opts.volumePath;
  return agentFsStorage({
    dataDir: opts.dataDir ?? DEFAULT_DATA_DIR,
    volumePath: fixedPath ? () => fixedPath : undefined,
  });
}

function resolveStorage(opts: CreateTenantHomeOptions): StorageAdapter {
  if (opts.storage) {
    if (opts.dataDir !== undefined || opts.volumePath !== undefined) {
      throw new Error("createTenantHome: pass `storage` or `dataDir`/`volumePath`, not both");
    }
    return opts.storage;
  }
  return legacyStorage(opts);
}

function resolveDefinition(opts: CreateTenantHomeOptions): AgentDefinition {
  if (opts.definition) return defineAgent(opts.definition);
  const model =
    typeof opts.model === "string" || opts.model === undefined
      ? (opts.model ?? DEFAULT_MODEL)
      : DEFAULT_MODEL;
  return defineAgent({ model });
}

/** Model the home runs: a ready LanguageModel from options, else the definition's id. */
function homeModel(opts: CreateTenantHomeOptions, definition: AgentDefinition): ModelInput {
  return typeof opts.model !== "string" && opts.model !== undefined ? opts.model : definition.model;
}

async function installEnvelope(volume: AgentFsLike, agent?: AgentBundle): Promise<void> {
  if (agent) {
    await installAgent(volume, agent);
  }
  if (FRAMEWORK_SKILLS.length) {
    await installAgent(volume, {
      skills: FRAMEWORK_SKILLS.map((s) => ({ ...s, tier: "framework" as const })),
    });
  }
}

async function bootHome(opts: CreateTenantHomeOptions, storage: StorageAdapter): Promise<TenantHome> {
  const tenantId = opts.tenantId;
  const shared = await openSharedStorage(storage, tenantId);
  const { opened } = shared;
  const { volume, location } = opened;
  const definition = resolveDefinition(opts);
  const agentFs = createAgentFs(volume);

  await installEnvelope(volume, opts.agent);

  const wantTranscripts = opts.transcripts !== false;
  const transcripts = wantTranscripts
    ? (opened.transcripts ?? (shared.fileTranscripts ??= new FileTranscriptStore({ fs: volume })))
    : undefined;

  const sandboxOpt = opts.sandbox;
  const wantSandbox = sandboxOpt !== false;
  let bash: TenantBashToolkit | undefined;
  const sandboxSecrets =
    typeof sandboxOpt === "object" && sandboxOpt.secrets ? sandboxOpt.secrets : undefined;
  if (wantSandbox) {
    const extra = typeof sandboxOpt === "object" ? sandboxOpt : {};
    const { createTenantBashToolkit } = await loadSandbox();
    bash = await createTenantBashToolkit({
      tenantId,
      agentFs: opened.agentFs,
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

  const curatorOpts = {
    curatorRunner: opts.curatorRunner,
    curatorModel: opts.curatorModel,
    curatorQueue: opts.curatorQueue,
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

    const activeDefinition = sessionDefinition
      ? defineAgent(sessionDefinition)
      : definition;

    const session = await openAgentSession({
      tenantId,
      fs: agentFs,
      definition: activeDefinition,
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

    return attachSessionCurator(session, {
      definition: activeDefinition,
      resolveOpts,
      sessionId,
      ...curatorOpts,
    });
  };

  const stores = async (): Promise<HomeStores> => {
    const runtime = new AgentSessionRuntime({
      tenantId,
      fs: agentFs,
      definition,
      secrets: sandboxSecrets,
    });
    await runtime.memory.loadFromDisk();
    return { memory: runtime.memory, skills: runtime.skills, pending: runtime.pending };
  };

  const review = async (input: CuratorJob): Promise<CuratorOutcome | null> => {
    const job = parseCuratorJob(input);
    if (job.tenantId !== tenantId) {
      throw new Error(`curator job for tenant '${job.tenantId}' sent to home '${tenantId}'`);
    }
    const runtime = new AgentSessionRuntime({
      tenantId,
      fs: agentFs,
      definition,
      origin: "background_review",
      secrets: sandboxSecrets,
    });
    const runner = resolveCuratorRunner(opts.curatorModel ?? homeModel(opts, definition), {
      curatorRunner: opts.curatorRunner,
      resolveOpts,
    });
    return reviewConversation(job.conversation, {
      definition,
      stores: { memory: runtime.memory, skills: runtime.skills, pending: runtime.pending },
      runner,
    });
  };

  return {
    tenantId,
    location,
    volumePath: location,
    volume,
    agentFs: opened.agentFs,
    definition,
    transcripts,
    bash,
    openSession,
    stores,
    review,
  };
}

/**
 * Build a home for one tenant with exactly these options. Storage is shared
 * per process (see createTenantHome); the home itself is not cached. Kits use
 * it so two kits in one process (for example a chat kit and a review kit with
 * another model) keep their own options on the same storage.
 */
export function openTenantHome(opts: CreateTenantHomeOptions): Promise<TenantHome> {
  const tenantId = opts.tenantId;
  if (!tenantId?.trim()) return Promise.reject(new Error("createTenantHome requires tenantId"));
  return bootHome(opts, resolveStorage(opts));
}

/**
 * Open (or reuse) the process-local home for one tenant. The first call for
 * a storage key decides the home's options; later calls get the same home.
 * Use createAgentKit for several configurations in one process.
 *
 * ```ts
 * import { agent } from "./generated/agent";
 * const home = await createTenantHome({ tenantId, agent });
 * const session = await home.openSession(sessionId);
 * ```
 *
 * @param opts - Tenant id, optional compiled `agent`, storage, model, sandbox.
 * @returns Cached {@link TenantHome} for the resolved storage key.
 */
export async function createTenantHome(opts: CreateTenantHomeOptions): Promise<TenantHome> {
  const tenantId = opts.tenantId;
  if (!tenantId?.trim()) throw new Error("createTenantHome requires tenantId");

  const storage = resolveStorage(opts);
  const key = storage.key(tenantId);
  const existing = homes.get(key);
  if (existing) {
    // Same guard as the storage cache, before handing out a cached home.
    const holder = storages.get(key);
    if (holder && holder.tenantId !== tenantId) {
      throw new Error(
        `Storage '${key}' is already open for tenant '${holder.tenantId}'. ` +
          "Each tenant needs its own volume.",
      );
    }
    return existing;
  }

  const boot = bootHome(opts, storage);
  homes.set(key, boot);
  try {
    return await boot;
  } catch (err) {
    homes.delete(key);
    throw err;
  }
}

/** Clear the home and storage caches (tests only). Does not close volumes. */
export function resetTenantHomeCache(): void {
  homes.clear();
  storages.clear();
}
