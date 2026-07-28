/**
 * Build a bash-tool toolkit scoped to one tenant.
 *
 * Integration follows the official just-bash + bash-tool + AgentFS pattern:
 *   https://github.com/vercel-labs/just-bash/tree/main/packages/just-bash
 *   https://github.com/vercel-labs/bash-tool#use-a-custom-just-bash-instance
 *   agentfs-sdk/just-bash → AgentFsWrapper
 *
 * When `agentFs` is provided, the workspace is a MountableFs mount:
 *   - base = just-bash default layout (/bin, /usr, …) so builtins like `ls` work
 *   - /workspace = AgentFS (durable SQLite), paths stored as /workspace/…
 */

import {
  createBashTool,
  type BashToolkit,
  type CommandResult,
  type Sandbox,
} from "bash-tool";
import {
  Bash,
  MountableFs,
  type BashOptions,
  type IFileSystem,
  type NetworkConfig,
} from "just-bash";
import { AgentFsWrapper, type AgentFsHandle } from "agentfs-sdk/just-bash";
import { TenantAgentFSSandbox } from "./tenant-sandbox.js";
import { InMemorySandboxAuditStore, FileSandboxAuditStore, type SandboxAuditStore } from "./audit.js";
import { makeBeforeBashCall, type GuardrailOptions } from "./guardrails.js";

export interface CreateTenantBashToolkitOptions extends GuardrailOptions {
  tenantId: string;
  /**
   * Open AgentFS handle (`AgentFS.open(...)`). When set, `/workspace` is backed
   * by AgentFS so files persist in the tenant SQLite volume (alongside
   * `memories/`, `agent/`, `skills/`). Omit for an ephemeral in-memory FS.
   */
  agentFs?: AgentFsHandle;
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

export interface TenantBashToolkit extends Omit<BashToolkit, "bash"> {
  audit: SandboxAuditStore;
  tenantSandbox: TenantAgentFSSandbox;
  /** The underlying just-bash `Bash` instance. */
  bash: Bash;
  /** True when `/workspace` I/O is backed by the AgentFS SQLite volume. */
  persisted: boolean;
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

/**
 * agentfs-sdk's AgentFsWrapper lags just-bash's IFileSystem (missing
 * `realpath` / `utimes`). Patch those methods until the SDK catches up.
 */
function toIFileSystem(inner: AgentFsWrapper): IFileSystem {
  const fs = inner as unknown as IFileSystem;
  return {
    getAllPaths: () => fs.getAllPaths(),
    resolvePath: (base, path) => fs.resolvePath(base, path),
    readFile: (path, opts) => fs.readFile(path, opts),
    readFileBuffer: (path) => fs.readFileBuffer(path),
    writeFile: (path, content, opts) => fs.writeFile(path, content, opts),
    appendFile: (path, content, opts) => fs.appendFile(path, content, opts),
    exists: (path) => fs.exists(path),
    stat: (path) => fs.stat(path),
    lstat: (path) => fs.lstat(path),
    mkdir: (path, opts) => fs.mkdir(path, opts),
    readdir: (path) => fs.readdir(path),
    rm: (path, opts) => fs.rm(path, opts),
    cp: (src, dest, opts) => fs.cp(src, dest, opts),
    mv: (src, dest) => fs.mv(src, dest),
    chmod: (path, mode) => fs.chmod(path, mode),
    symlink: (target, linkPath) => fs.symlink(target, linkPath),
    link: (existing, neu) => fs.link(existing, neu),
    readlink: (path) => fs.readlink(path),
    realpath: async (path) => (typeof fs.realpath === "function" ? fs.realpath(path) : path),
    utimes: async (path, atime, mtime) => {
      if (typeof fs.utimes === "function") await fs.utimes(path, atime, mtime);
    },
  };
}

/**
 * MountableFs strips the mount prefix before calling the child FS. Re-prefix
 * so AgentFS stores `/workspace/...` (visible next to memories/agent/skills).
 */
export function prefixFileSystem(inner: IFileSystem, prefix: string): IFileSystem {
  const root = prefix.replace(/\/$/, "") || "";
  const map = (path: string): string => {
    if (!path || path === "/") return root || "/";
    return `${root}${path.startsWith("/") ? path : `/${path}`}`;
  };
  const unmap = (path: string): string => {
    if (!root) return path;
    if (path === root || path === `${root}/`) return "/";
    if (path.startsWith(`${root}/`)) return path.slice(root.length);
    return path;
  };
  return {
    getAllPaths: () => (inner.getAllPaths?.() ?? []).map(unmap),
    resolvePath: (base, path) => inner.resolvePath(base, path),
    readFile: (path, opts) => inner.readFile(map(path), opts),
    readFileBuffer: (path) => inner.readFileBuffer(map(path)),
    writeFile: (path, content, opts) => inner.writeFile(map(path), content, opts),
    appendFile: (path, content, opts) => inner.appendFile(map(path), content, opts),
    exists: (path) => inner.exists(map(path)),
    stat: (path) => inner.stat(map(path)),
    lstat: (path) => inner.lstat(map(path)),
    mkdir: (path, opts) => inner.mkdir(map(path), opts),
    readdir: (path) => inner.readdir(map(path)),
    rm: (path, opts) => inner.rm(map(path), opts),
    cp: (src, dest, opts) => inner.cp(map(src), map(dest), opts),
    mv: (src, dest) => inner.mv(map(src), map(dest)),
    chmod: (path, mode) => inner.chmod(map(path), mode),
    symlink: (target, linkPath) => inner.symlink(target, map(linkPath)),
    link: (existing, neu) => inner.link(map(existing), map(neu)),
    readlink: (path) => inner.readlink(map(path)),
    realpath: async (path) => unmap(await inner.realpath(map(path))),
    utimes: (path, atime, mtime) => inner.utimes(map(path), atime, mtime),
  };
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

function staticToolPrompt(destination: string, persisted: boolean): string {
  return [
    `You have bash, readFile, and writeFile inside an isolated just-bash workspace.`,
    `Working directory: ${destination}.`,
    persisted
      ? `Workspace files persist in the tenant AgentFS volume under ${destination}/ (same SQLite DB as memories/skills).`
      : `Workspace files are in-memory for this process only.`,
    `Common Unix utilities are available (ls, cat, grep, sed, jq, …).`,
    `Prefer relative paths under the workspace.`,
    `Destructive commands and non-allowlisted network egress are blocked by agent-kit.`,
    `just-bash has no host shell access; python/js-exec are off unless explicitly enabled.`,
  ].join(" ");
}

async function seedMissingFiles(fs: IFileSystem, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    if (await fs.exists(path)) continue;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent && parent !== "/") {
      await fs.mkdir(parent, { recursive: true });
    }
    await fs.writeFile(path, content);
  }
}

/**
 * Default just-bash layout (/bin, /usr, /home, …) as a MountableFs base so
 * command resolution and `ls /bin` keep working when /workspace is AgentFS.
 */
function defaultLayoutFs(): IFileSystem {
  return new Bash({ defenseInDepth: false }).fs;
}

function buildPersistedWorkspaceFs(agentFs: AgentFsHandle, destination: string): IFileSystem {
  const agentRoot = toIFileSystem(new AgentFsWrapper({ fs: agentFs, mountPoint: "/" }));
  const workspaceStore = prefixFileSystem(agentRoot, destination);
  return new MountableFs({
    base: defaultLayoutFs(),
    mounts: [{ mountPoint: destination, filesystem: workspaceStore }],
  });
}

/**
 * Create AI SDK bash / readFile / writeFile tools for one tenant.
 * Commands run in just-bash (not the host shell), behind agent-kit guardrails.
 * Pass `agentFs` to persist `/workspace` in the tenant AgentFS SQLite volume.
 */
export async function createTenantBashToolkit(
  options: CreateTenantBashToolkitOptions,
): Promise<TenantBashToolkit> {
  const destination = options.destination ?? "/workspace";
  const audit =
    options.audit ??
    (options.agentFs
      ? new FileSandboxAuditStore({
          fs: {
            readFile: async (path) => {
              try {
                return await options.agentFs!.fs.readFile(path, "utf8");
              } catch {
                return null;
              }
            },
            writeFile: async (path, content) => {
              await options.agentFs!.fs.writeFile(path, content, "utf8");
            },
          },
        })
      : new InMemorySandboxAuditStore());
  const seedFiles = toAbsoluteSeedFiles(options.files, destination);
  const persisted = Boolean(options.agentFs);

  const fs: IFileSystem | undefined = options.agentFs
    ? buildPersistedWorkspaceFs(options.agentFs, destination)
    : undefined;

  if (fs && Object.keys(seedFiles).length) {
    await seedMissingFiles(fs, seedFiles);
  }

  const bash = new Bash({
    cwd: destination,
    ...(fs ? { fs } : { files: seedFiles }),
    env: {
      HOME: destination,
      TERM: "dumb",
    },
    executionLimitProfile: options.executionLimitProfile ?? "hardened",
    network: toJustBashNetwork(options.allowedHosts),
    defenseInDepth: resolveDefenseInDepth(options.defenseInDepth),
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

  const toolkit = await createBashTool({
    sandbox: tenantSandbox,
    destination,
    files: options.files,
    promptOptions: {
      toolPrompt: staticToolPrompt(destination, persisted),
    },
    onBeforeBashCall: makeBeforeBashCall(options),
    extraInstructions:
      options.extraInstructions ??
      [
        "You are inside an isolated just-bash sandbox for this tenant.",
        persisted
          ? "Workspace files are stored in the tenant AgentFS volume under /workspace and survive restarts."
          : "The host machine is not available.",
        "Prefer relative paths under the workspace.",
        "Destructive commands and non-allowlisted network egress are blocked.",
      ].join(" "),
  });

  return {
    ...toolkit,
    sandbox: tenantSandbox,
    tenantSandbox,
    bash,
    audit,
    persisted,
  };
}
