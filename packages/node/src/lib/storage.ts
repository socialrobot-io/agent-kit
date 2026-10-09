/**
 * Pluggable tenant storage for {@link createTenantHome}.
 *
 * A storage adapter opens one tenant's durable state: the agent-home
 * filesystem (agent files, memory, skills, pending writes) and, optionally,
 * a transcript store. The default adapter is one AgentFS SQLite file per
 * tenant on local disk ({@link agentFsStorage}). Shared backends, such as
 * `@socialrobot-io/agent-kit-node/postgres`, let several processes and machines
 * serve the same tenant.
 *
 * The sandbox package (AgentFS, just-bash) loads lazily, only when a home
 * opens an AgentFS volume or creates bash tools. Hosts on another backend
 * with `sandbox: false` never load its native bindings.
 */

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentFsLike } from "@socialrobot-io/agent-kit-core";
import type { TranscriptStore } from "@socialrobot-io/agent-kit-sessions";
import type { TenantVolume } from "@socialrobot-io/agent-kit-sandbox";

/**
 * Privileged agent-home filesystem that a storage adapter opens for one
 * tenant. The host seeds agent files through it; sessions get a
 * policy-wrapped view (`createAgentFs`).
 *
 * Contract (same as `AgentFsLike`): `readFile` returns `null` for a missing
 * file, `list` returns `[]` for a missing directory, and `deleteFile` on a
 * missing path does nothing. Backends shared across processes should
 * implement `exclusive` (see `ExclusiveFs` in core) so memory and skill
 * edits do not overwrite each other.
 */
export type StorageVolume = AgentFsLike & {
  /** Delete a file. Pending discard and skill deletion need it. */
  deleteFile(path: string): Promise<void>;
};

/** What a storage adapter returns for one tenant. */
export interface TenantStorage {
  /** Privileged agent-home filesystem for this tenant. */
  volume: StorageVolume;
  /**
   * Transcript store bound to this tenant. Omit it to keep transcripts as
   * files on `volume` (`FileTranscriptStore`).
   */
  transcripts?: TranscriptStore;
  /** Where the data lives: a file path or a backend label. Use it in logs. */
  location: string;
  /**
   * AgentFS handle when the backend is an AgentFS volume. The bash sandbox
   * then keeps `/workspace` on the volume. Without it, `/workspace` lives in
   * process memory: it is lost on restart and is not shared across processes.
   */
  agentFs?: TenantVolume["agentFs"];
}

/** Opens tenant storage. One adapter instance serves every tenant. */
export interface StorageAdapter {
  /**
   * Stable key for one tenant's storage. Homes with the same key share one
   * entry in the per-process home cache. Two tenants must never share a key.
   */
  key(tenantId: string): string;
  /** Open storage for one tenant. Never return another tenant's data. */
  open(tenantId: string): Promise<TenantStorage>;
}

/** Options for {@link agentFsStorage}. */
export interface AgentFsStorageOptions {
  /**
   * Directory for tenant volumes. Volumes go to
   * `${dataDir}/tenants/${tenantId}.db`. Default `./data`.
   */
  dataDir?: string;
  /** Full volume path for a tenant. Overrides the `dataDir` convention. */
  volumePath?: (tenantId: string) => string;
}

type SandboxModule = typeof import("@socialrobot-io/agent-kit-sandbox");

let sandboxModule: Promise<SandboxModule> | undefined;

/** Load the sandbox package on first use (AgentFS and just-bash are native or heavy). */
export function loadSandbox(): Promise<SandboxModule> {
  sandboxModule ??= import("@socialrobot-io/agent-kit-sandbox").catch((err: unknown) => {
    sandboxModule = undefined;
    throw err;
  });
  return sandboxModule;
}

/**
 * Open one AgentFS tenant volume (lazy wrapper over the sandbox package's
 * `openTenantVolume`). Cached per path in this process.
 *
 * @param volumePath - Path to the tenant SQLite file (created if missing).
 */
export async function openTenantVolume(volumePath: string): Promise<TenantVolume> {
  const sandbox = await loadSandbox();
  return sandbox.openTenantVolume(volumePath);
}

/** Default volume path for a tenant under `dataDir`. */
export function defaultVolumePath(dataDir: string, tenantId: string): string {
  return join(dataDir, "tenants", `${tenantId}.db`);
}

/**
 * Default storage: one AgentFS SQLite file per tenant on local disk.
 * Transcripts are files on the same volume. One process per volume: AgentFS
 * takes an exclusive lock on the file.
 */
export function agentFsStorage(opts: AgentFsStorageOptions = {}): StorageAdapter {
  const dataDir = opts.dataDir ?? "./data";
  const pathFor = (tenantId: string) =>
    opts.volumePath ? opts.volumePath(tenantId) : defaultVolumePath(dataDir, tenantId);

  return {
    key: pathFor,
    async open(tenantId) {
      const location = pathFor(tenantId);
      await mkdir(dirname(location), { recursive: true });
      const volume = await openTenantVolume(location);
      return { volume, location, agentFs: volume.agentFs };
    },
  };
}
