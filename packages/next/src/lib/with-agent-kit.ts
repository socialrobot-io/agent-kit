/**
 * Next.js config helper for agent-kit.
 *
 * Merges the Node-only native packages, ships the agents directory for
 * serverless tracing, and sets `AGENT_KIT_AGENTS_DIR` so `loadAgent("chat")`
 * resolves the same folder Next includes.
 */

/** Defaults Next expects for agent-kit native deps. */
export const AGENT_KIT_SERVER_EXTERNAL_PACKAGES = [
  "agentfs-sdk",
  "just-bash",
  "bash-tool",
] as const;

/** Env key read by `loadAgent` for the agents root (must match tracing). */
export const AGENT_KIT_AGENTS_DIR_ENV = "AGENT_KIT_AGENTS_DIR";

export interface WithAgentKitOptions {
  /**
   * Folder of agent directories, relative to the Next app root (same level as
   * `app/` / `src/app`). Default `agents`.
   *
   * Examples: `agents`, `./agents`, `src/agents`.
   *
   * Sets both file tracing and `process.env.AGENT_KIT_AGENTS_DIR` so
   * `loadAgent("chat")` opens `{agentsDir}/chat`.
   */
  agentsDir?: string;
  /** Extra packages to keep outside the server bundle. */
  serverExternalPackages?: string[];
}

/** Minimal Next config shape we merge into (avoids a hard runtime dep on `next`). */
export interface AgentKitNextConfig {
  serverExternalPackages?: string[];
  outputFileTracingIncludes?: Record<string, string | string[]>;
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Normalize an agents directory relative to the app root.
 * `agents` / `./agents` → `agents`
 */
export function normalizeAgentsDir(agentsDir: string): string {
  let dir = agentsDir.trim().replaceAll("\\", "/");
  if (!dir) throw new Error("withAgentKit: agentsDir must be non-empty");
  if (dir.startsWith("/") || /^[A-Za-z]:\//.test(dir)) {
    throw new Error(
      "withAgentKit: agentsDir must be relative to the Next app root (e.g. \"agents\" or \"src/agents\")",
    );
  }
  dir = dir.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!dir || dir.includes("..")) {
    throw new Error(
      'withAgentKit: agentsDir must be a simple relative path (e.g. "agents" or "src/agents")',
    );
  }
  return dir;
}

/**
 * Normalize an agents directory to a tracing glob under the app root.
 * `agents` / `./agents` → `./agents/**\/*`
 */
export function agentsTraceGlob(agentsDir: string): string {
  return `./${normalizeAgentsDir(agentsDir)}/**/*`;
}

function asStringArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Wrap `next.config` so agent-kit works on App Router without manual tracing
 * and native-package setup.
 *
 * @example
 * ```ts
 * import type { NextConfig } from "next";
 * import { withAgentKit } from "@socialrobot-io/agent-kit-next";
 *
 * const nextConfig: NextConfig = {};
 * export default withAgentKit(nextConfig);
 * // agents live at ./agents — loadAgent("chat")
 *
 * export default withAgentKit(nextConfig, { agentsDir: "src/agents" });
 * // loadAgent("chat") → src/agents/chat (tracing matches)
 * ```
 */
export function withAgentKit<T extends AgentKitNextConfig>(
  nextConfig: T = {} as T,
  options: WithAgentKitOptions = {},
): T {
  const agentsDir = normalizeAgentsDir(options.agentsDir ?? "agents");
  const agentsGlob = `./${agentsDir}/**/*`;

  const serverExternalPackages = unique([
    ...AGENT_KIT_SERVER_EXTERNAL_PACKAGES,
    ...(options.serverExternalPackages ?? []),
    ...(nextConfig.serverExternalPackages ?? []),
  ]);

  const existingIncludes = nextConfig.outputFileTracingIncludes ?? {};
  const starIncludes = asStringArray(existingIncludes["/*"]);
  const outputFileTracingIncludes = {
    ...existingIncludes,
    "/*": unique([...starIncludes, agentsGlob]),
  };

  const env = {
    ...(nextConfig.env ?? {}),
    [AGENT_KIT_AGENTS_DIR_ENV]: agentsDir,
  };

  return {
    ...nextConfig,
    env,
    serverExternalPackages,
    outputFileTracingIncludes,
  };
}
