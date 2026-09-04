/**
 * Build-free entry for next.config (Node must resolve this before `dist/` exists).
 * Keep in sync with `src/lib/with-agent-kit.ts`.
 */

/** @type {readonly string[]} */
export const AGENT_KIT_SERVER_EXTERNAL_PACKAGES = [
  "agentfs-sdk",
  "just-bash",
  "bash-tool",
];

export const AGENT_KIT_AGENTS_DIR_ENV = "AGENT_KIT_AGENTS_DIR";

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function unique(values) {
  return [...new Set(values)];
}

/**
 * @param {string} agentsDir
 * @returns {string}
 */
export function normalizeAgentsDir(agentsDir) {
  let dir = agentsDir.trim().replaceAll("\\", "/");
  if (!dir) throw new Error("withAgentKit: agentsDir must be non-empty");
  if (dir.startsWith("/") || /^[A-Za-z]:\//.test(dir)) {
    throw new Error(
      'withAgentKit: agentsDir must be relative to the Next app root (e.g. "agents" or "src/agents")',
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
 * @param {string} agentsDir
 * @returns {string}
 */
export function agentsTraceGlob(agentsDir) {
  return `./${normalizeAgentsDir(agentsDir)}/**/*`;
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
function asStringArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} [nextConfig]
 * @param {{ agentsDir?: string; serverExternalPackages?: string[] }} [options]
 * @returns {T}
 */
export function withAgentKit(nextConfig = /** @type {T} */ ({}), options = {}) {
  const agentsDir = normalizeAgentsDir(options.agentsDir ?? "agents");
  const agentsGlob = `./${agentsDir}/**/*`;

  const serverExternalPackages = unique([
    ...AGENT_KIT_SERVER_EXTERNAL_PACKAGES,
    ...(options.serverExternalPackages ?? []),
    ...((/** @type {{ serverExternalPackages?: string[] }} */ (nextConfig)
      .serverExternalPackages) ?? []),
  ]);

  const existingIncludes =
    (/** @type {{ outputFileTracingIncludes?: Record<string, string | string[]> }} */ (
      nextConfig
    ).outputFileTracingIncludes) ?? {};
  const starIncludes = asStringArray(existingIncludes["/*"]);
  const outputFileTracingIncludes = {
    ...existingIncludes,
    "/*": unique([...starIncludes, agentsGlob]),
  };

  const env = {
    ...((/** @type {{ env?: Record<string, string | undefined> }} */ (nextConfig).env) ??
      {}),
    [AGENT_KIT_AGENTS_DIR_ENV]: agentsDir,
  };

  return {
    ...nextConfig,
    env,
    serverExternalPackages,
    outputFileTracingIncludes,
  };
}
