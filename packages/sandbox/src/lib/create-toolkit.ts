/**
 * Build a bash-tool toolkit scoped to one tenant.
 *
 * Integration follows the official just-bash + bash-tool pattern:
 *   https://github.com/vercel-labs/just-bash/tree/main/packages/just-bash
 *   https://github.com/vercel-labs/bash-tool#use-a-custom-just-bash-instance
 *
 * 1. Construct a `Bash` instance with cwd, seed files, network allowlist,
 *    hardened execution limits, and DefenseInDepth (off under Next.js).
 * 2. Pass that instance to `createBashTool({ sandbox })` so bash-tool wraps
 *    it via `isJustBash` / `wrapJustBash`.
 * 3. Layer agent-kit guardrails via `onBeforeBashCall` and audit via
 *    `onAfterBashCall` + TenantAgentFSSandbox for direct sandbox calls.
 */

import {
  createBashTool,
  type BashToolkit,
  type CommandResult,
  type Sandbox,
} from "bash-tool";
import { Bash, type BashOptions, type NetworkConfig } from "just-bash";
import { TenantAgentFSSandbox } from "./tenant-sandbox.js";
import { InMemorySandboxAuditStore, type SandboxAuditStore } from "./audit.js";
import { makeBeforeBashCall, type GuardrailOptions } from "./guardrails.js";

export interface CreateTenantBashToolkitOptions extends GuardrailOptions {
  tenantId: string;
  /** Working directory inside the just-bash volume. Default `/workspace`. */
  destination?: string;
  /** Seed files relative to `destination` (or absolute POSIX paths). */
  files?: Record<string, string>;
  /** Extra instructions appended to tool descriptions. */
  extraInstructions?: string;
  audit?: SandboxAuditStore;
  /**
   * Override just-bash DefenseInDepth. Default: off under Next.js (its
   * Date.now / process.env patches recurse with DID), otherwise `{ enabled: "auto" }`.
   */
  defenseInDepth?: BashOptions["defenseInDepth"];
  /** just-bash execution limit profile. Default `hardened` for untrusted agents. */
  executionLimitProfile?: BashOptions["executionLimitProfile"];
}

export interface TenantBashToolkit extends BashToolkit {
  audit: SandboxAuditStore;
  tenantSandbox: TenantAgentFSSandbox;
  /** The underlying just-bash `Bash` instance. */
  bash: Bash;
}

/** Absolute POSIX paths under `destination` for just-bash `files`. */
export function toAbsoluteSeedFiles(
  files: Record<string, string> | undefined,
  destination: string,
): Record<string, string> {
  if (!files) return {};
  const out: Record<string, string> = {};
  const root = destination.replace(/\/$/, "") || "/";
  for (const [rel, content] of Object.entries(files)) {
    const path = rel.startsWith("/") ? rel : `${root}/${rel}`;
    out[path] = content;
  }
  return out;
}

/**
 * Map agent-kit host allowlist → just-bash `network` config.
 * Network is off by default in just-bash; curl only exists when configured.
 */
export function toJustBashNetwork(allowedHosts?: string[]): NetworkConfig | undefined {
  if (!allowedHosts?.length) return undefined;
  const prefixes = new Set<string>();
  for (const host of allowedHosts) {
    const h = host.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    if (!h) continue;
    prefixes.add(`https://${h}`);
    prefixes.add(`http://${h}`);
  }
  return {
    allowedUrlPrefixes: [...prefixes],
    allowedMethods: ["GET", "HEAD"],
  };
}

/**
 * Next.js patches Date.now and process.env. just-bash DefenseInDepth records
 * violations with Date.now() and proxies process.env — under Next those paths
 * recurse until the stack overflows. Keep DID off in Next runtimes; elsewhere
 * use the recommended `"auto"` capability detection.
 */
export function resolveDefenseInDepth(
  override?: BashOptions["defenseInDepth"],
): BashOptions["defenseInDepth"] {
  if (override !== undefined) return override;
  if (process.env.NEXT_RUNTIME || process.env.__NEXT_PRIVATE_ORIGIN) {
    return false;
  }
  return { enabled: "auto" };
}

function wrapJustBash(bash: Bash, cwd: string): Sandbox {
  return {
    async executeCommand(command: string): Promise<CommandResult> {
      const result = await bash.exec(command, { cwd });
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.exitCode ?? 0,
      };
    },
    async readFile(path: string): Promise<string> {
      return bash.fs.readFile(path);
    },
    async writeFiles(files: Array<{ path: string; content: string | Buffer }>): Promise<void> {
      for (const f of files) {
        const content = typeof f.content === "string" ? f.content : f.content.toString("utf8");
        await bash.fs.writeFile(f.path, content);
      }
    },
  };
}

function staticToolPrompt(destination: string): string {
  return [
    `You have bash, readFile, and writeFile inside an isolated just-bash workspace.`,
    `Working directory: ${destination}.`,
    `Common Unix utilities are available (ls, cat, grep, sed, jq, …).`,
    `Prefer relative paths under the workspace.`,
    `Destructive commands and non-allowlisted network egress are blocked by agent-kit.`,
    `just-bash has no host shell access; python/js-exec are off unless explicitly enabled.`,
  ].join(" ");
}

/**
 * Create AI SDK bash / readFile / writeFile tools for one tenant.
 * Commands run in just-bash (not the host shell), behind agent-kit guardrails.
 */
export async function createTenantBashToolkit(
  options: CreateTenantBashToolkitOptions,
): Promise<TenantBashToolkit> {
  const destination = options.destination ?? "/workspace";
  const audit = options.audit ?? new InMemorySandboxAuditStore();
  const seedFiles = toAbsoluteSeedFiles(options.files, destination);

  // Official just-bash construction: in-memory FS, hardened limits, optional network.
  const bash = new Bash({
    cwd: destination,
    files: seedFiles,
    env: {
      HOME: destination,
      TERM: "dumb",
    },
    executionLimitProfile: options.executionLimitProfile ?? "hardened",
    network: toJustBashNetwork(options.allowedHosts),
    defenseInDepth: resolveDefenseInDepth(options.defenseInDepth),
    // Keep python / javascript off (extra security surface; enable explicitly later).
  });

  const inner = wrapJustBash(bash, destination);

  const tenantSandbox = new TenantAgentFSSandbox({
    tenantId: options.tenantId,
    audit,
    allowedHosts: options.allowedHosts,
    blockedPatterns: options.blockedPatterns,
    secrets: options.secrets,
    fs: {
      readFile: (path) => inner.readFile(path),
      writeFile: async (path, content) => {
        const data = typeof content === "string" ? content : Buffer.from(content);
        await inner.writeFiles([{ path, content: data }]);
      },
    },
    executor: (command) => inner.executeCommand(command),
  });

  // Official bash-tool pattern: pass a just-bash-backed Sandbox + interceptors.
  // We pass TenantAgentFSSandbox (implements bash-tool Sandbox) so every path —
  // AI tools and direct sandbox.executeCommand — hits guardrails + audit.
  // Seed files are already in Bash; pass relative `files` only for tool descriptions.
  const toolkit = await createBashTool({
    sandbox: tenantSandbox,
    destination,
    files: options.files,
    promptOptions: {
      // Skip live `ls /usr/bin` discovery during init (avoids extra exec under Next).
      toolPrompt: staticToolPrompt(destination),
    },
    // bash-tool interceptor (docs): complements TenantAgentFSSandbox guardrails.
    onBeforeBashCall: makeBeforeBashCall(options),
    extraInstructions:
      options.extraInstructions ??
      [
        "You are inside an isolated just-bash sandbox for this tenant.",
        "The host machine is not available. Prefer relative paths under the workspace.",
        "Destructive commands and non-allowlisted network egress are blocked.",
      ].join(" "),
  });

  return {
    ...toolkit,
    sandbox: tenantSandbox,
    tenantSandbox,
    bash,
    audit,
  };
}
