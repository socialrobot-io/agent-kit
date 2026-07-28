/**
 * Build a bash-tool toolkit scoped to one tenant: just-bash execution,
 * TenantAgentFSSandbox guardrails + audit, AI SDK tools ready for the loop.
 */

import { createBashTool, type BashToolkit, type CommandResult, type Sandbox } from "bash-tool";
import { Bash } from "just-bash";
import { TenantAgentFSSandbox } from "./tenant-sandbox.js";
import { InMemorySandboxAuditStore, type SandboxAuditStore } from "./audit.js";
import type { GuardrailOptions } from "./guardrails.js";

export interface CreateTenantBashToolkitOptions extends GuardrailOptions {
  tenantId: string;
  /** Working directory inside the just-bash volume. Default `/workspace`. */
  destination?: string;
  /** Seed files relative to `destination`. */
  files?: Record<string, string>;
  /** Extra instructions appended to tool descriptions. */
  extraInstructions?: string;
  audit?: SandboxAuditStore;
}

export interface TenantBashToolkit extends BashToolkit {
  audit: SandboxAuditStore;
  tenantSandbox: TenantAgentFSSandbox;
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

/**
 * Create AI SDK bash / readFile / writeFile tools for one tenant.
 * Commands run in just-bash (not the host shell), behind agent-kit guardrails.
 */
export async function createTenantBashToolkit(
  options: CreateTenantBashToolkitOptions,
): Promise<TenantBashToolkit> {
  const destination = options.destination ?? "/workspace";
  const audit = options.audit ?? new InMemorySandboxAuditStore();
  // Next.js patches Date.now / process.env; just-bash DefenseInDepth conflicts
  // with those patches and can recurse until the stack blows. Our TenantAgentFS
  // guardrails still block destructive / exfil commands.
  const justBash = new Bash({ cwd: destination, defenseInDepth: false });
  const inner = wrapJustBash(justBash, destination);

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
    // Skip live tool discovery (runs bash during init); a static prompt is enough.
    promptOptions: {
      toolPrompt:
        "You have bash, readFile, and writeFile inside an isolated just-bash workspace. " +
        "Common Unix utilities are available. Prefer relative paths under the workspace. " +
        "Destructive commands and non-allowlisted network egress are blocked by agent-kit.",
    },
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
    audit,
  };
}
