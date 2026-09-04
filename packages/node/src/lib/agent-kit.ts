/**
 * One entry point for hosts. {@link createAgentKit} opens a tenant home (cached
 * per process, bounded by the number of tenants) and a chat session on demand.
 *
 * Default is **stateless**: `kit.session(tenantId, sessionId)` opens a fresh
 * session each call — state is on disk (volume + transcripts), not in memory.
 * Set `maxSessions` to opt into a per-chat session cache (LRU) for the perf win.
 *
 * For advanced hosts that need the volume, transcripts, or sandbox pieces
 * directly, {@link createTenantHome} stays exported.
 */

import type { AgentSession } from "@socialrobot-io/agent-kit-ai";
import {
  createTenantHome,
  resetTenantHomeCache,
  type CreateTenantHomeOptions,
  type OpenHomeSessionOptions,
  type TenantHome,
} from "./tenant-home.js";

/** Options shared across tenants (everything but `tenantId`). */
export type CreateAgentKitOptions = Omit<CreateTenantHomeOptions, "tenantId"> & {
  /**
   * Opt into a per-chat session cache (LRU). When set, `kit.session` reuses
   * the live handle for a `tenantId:sessionId` across requests; when the cap
   * is exceeded the oldest is dropped. Default (unset) is stateless: each
   * call opens a fresh session from disk.
   */
  maxSessions?: number;
  /**
   * Called before opening a session, after the tenant home is ready. In
   * stateless mode (no `maxSessions`) this fires on every call; in cached
   * mode it fires only on a cache miss. Use it to re-seed agent files from
   * disk during dev so edits to `agents/` land without a restart.
   */
  onBeforeSession?: (
    home: TenantHome,
    tenantId: string,
    sessionId: string,
  ) => Promise<unknown>;
};

/** Per-chat session options (everything but `tenantId` / `sessionId`). */
export type KitSessionOptions = Omit<OpenHomeSessionOptions, never>;

/** One process-local kit: tenant homes + (optional) live chat sessions. */
export interface AgentKit {
  /** Shared options applied to every tenant home this kit opens. */
  readonly options: CreateAgentKitOptions;
  /**
   * Open a live {@link AgentSession} for one chat. Stateless by default: each
   * call opens a fresh session (state lives on disk). With `maxSessions` set,
   * the live handle is reused across requests for the same `tenantId:sessionId`.
   *
   * @param tenantId - Stable id from your auth layer. Never from the body alone.
   * @param sessionId - Chat id.
   * @param opts - Per-chat overrides (model, tools, approval, …).
   */
  session: (
    tenantId: string,
    sessionId: string,
    opts?: KitSessionOptions,
  ) => Promise<AgentSession>;
  /** Advanced: the cached {@link TenantHome} for a tenant, if opened here. */
  home: (tenantId: string) => Promise<TenantHome>;
  /** Session ids currently cached for a tenant (observability / debug UI). */
  openSessions: (tenantId: string) => string[];
  /** Drop the cached session for one chat (no-op in stateless mode). */
  closeSession: (tenantId: string, sessionId: string) => void;
  /** Clear all cached sessions and homes (tests only). Does not close volumes. */
  reset: () => void;
}

function sessionKey(tenantId: string, sessionId: string): string {
  return `${tenantId}\u0000${sessionId}`;
}

/**
 * Build the host entry point. Create once at module scope; call
 * `kit.session(tenantId, sessionId)` from each request.
 *
 * ```ts
 * import { createAgentKit, loadAgent } from "@socialrobot-io/agent-kit-node";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * export const kit = createAgentKit({
 *   agent: await loadAgent("chat"),
 *   model: anthropic("claude-sonnet-4-5"),
 * });
 *
 * // in a route (stateless — fresh session each call):
 * const session = await kit.session(tenantId, sessionId);
 * ```
 *
 * @param opts - Shared tenant-home options (agent, model, dataDir, sandbox, …).
 */
export function createAgentKit(opts: CreateAgentKitOptions = {}): AgentKit {
  const homes = new Map<string, Promise<TenantHome>>();
  const sessions = new Map<string, Promise<AgentSession>>();
  const caching = opts.maxSessions && opts.maxSessions > 0;
  const maxSessions = caching ? (opts.maxSessions as number) : 0;
  const onBeforeSession = opts.onBeforeSession;

  const home = (tenantId: string): Promise<TenantHome> => {
    const existing = homes.get(tenantId);
    if (existing) return existing;
    const boot = createTenantHome({ ...opts, tenantId });
    homes.set(tenantId, boot);
    boot.catch(() => homes.delete(tenantId));
    return boot;
  };

  const evictIfNeeded = (): void => {
    while (sessions.size >= maxSessions) {
      const oldest = sessions.keys().next().value;
      if (oldest === undefined) break;
      sessions.delete(oldest);
    }
  };

  const openFresh = async (
    tenantId: string,
    sessionId: string,
    openOpts: KitSessionOptions | undefined,
    cacheHit: boolean,
  ): Promise<AgentSession> => {
    const h = await home(tenantId);
    if (!cacheHit && onBeforeSession) await onBeforeSession(h, tenantId, sessionId);
    return h.openSession(sessionId, openOpts);
  };

  const session = async (
    tenantId: string,
    sessionId: string,
    openOpts?: KitSessionOptions,
  ): Promise<AgentSession> => {
    const key = sessionKey(tenantId, sessionId);

    if (caching) {
      const cached = sessions.get(key);
      if (cached) {
        // Mark recently used (LRU): re-insert at the tail.
        sessions.delete(key);
        sessions.set(key, cached);
        return cached;
      }
      evictIfNeeded();
      const opened = openFresh(tenantId, sessionId, openOpts, false);
      sessions.set(key, opened);
      opened.catch(() => sessions.delete(key));
      return opened;
    }

    // Stateless: open fresh each call, do not retain the handle.
    return openFresh(tenantId, sessionId, openOpts, false);
  };

  const closeSession = (tenantId: string, sessionId: string): void => {
    sessions.delete(sessionKey(tenantId, sessionId));
  };

  const openSessions = (tenantId: string): string[] => {
    const prefix = `${tenantId}\u0000`;
    const out: string[] = [];
    for (const key of sessions.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out;
  };

  const reset = (): void => {
    sessions.clear();
    homes.clear();
    resetTenantHomeCache();
  };

  return {
    options: opts,
    session,
    home,
    openSessions,
    closeSession,
    reset,
  };
}
