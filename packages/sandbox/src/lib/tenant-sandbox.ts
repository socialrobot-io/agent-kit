/**
 * Per-tenant AgentFS sandbox backend for bash-tool.
 *
 * Each tenant gets its own AgentFS volume (one SQLite file per tenant), giving
 * isolation, snapshots, rollback, and audit. The bash-tool `Sandbox` interface
 * (`executeCommand`, `readFile`, `writeFiles`) is implemented by running
 * commands in just-bash against that tenant's AgentFS filesystem — never the
 * host shell. Tenants never share a filesystem, so a bug cannot cross tenants.
 *
 * See https://www.agentfs.ai/ and https://github.com/vercel-labs/bash-tool .
 */

import type { Sandbox, CommandResult } from "bash-tool";
import { evaluateCommand, type GuardrailOptions } from "./guardrails.js";
import { makeAuditRecord, type SandboxAuditStore } from "./audit.js";

/**
 * Minimal filesystem surface the sandbox needs. Satisfied by an AgentFS
 * `FileSystem` (via the agentfs-sdk just-bash integration) or a test double.
 * Paths are POSIX within the tenant's isolated volume.
 */
export interface SandboxFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  exists?(path: string): Promise<boolean>;
}

/**
 * Executes a command string in the tenant sandbox. The production
 * implementation is just-bash bound to the tenant's AgentFS volume; tests can
 * inject a stub.
 */
export type CommandExecutor = (command: string) => Promise<CommandResult>;

export interface TenantSandboxOptions extends GuardrailOptions {
  tenantId: string;
  audit?: SandboxAuditStore;
  executor: CommandExecutor;
  fs: SandboxFs;
  /** Returns the current AgentFS snapshot id, when the backend supports it. */
  getSnapshotId?: () => Promise<string | undefined>;
}

/**
 * A bash-tool `Sandbox` scoped to one tenant's AgentFS volume with guardrails
 * and audit. Pass to `createBashTool({ sandbox })`.
 */
export class TenantAgentFSSandbox implements Sandbox {
  private readonly tenantId: string;
  private readonly executor: CommandExecutor;
  private readonly fs: SandboxFs;
  private readonly audit?: SandboxAuditStore;
  private readonly guardrails: GuardrailOptions;
  private readonly getSnapshotId?: () => Promise<string | undefined>;

  constructor(options: TenantSandboxOptions) {
    this.tenantId = options.tenantId;
    this.executor = options.executor;
    this.fs = options.fs;
    this.audit = options.audit;
    this.getSnapshotId = options.getSnapshotId;
    const { allowedHosts, blockedPatterns, secrets } = options;
    this.guardrails = { allowedHosts, blockedPatterns, secrets };
  }

  async executeCommand(command: string): Promise<CommandResult> {
    const decision = evaluateCommand(command, this.guardrails);
    if (decision.blocked) {
      const result: CommandResult = { stdout: "", stderr: decision.blocked, exitCode: 1 };
      await this.record("bash", command, { exitCode: 1 });
      return result;
    }
    const result = await this.executor(decision.command ?? command);
    await this.record("bash", command, { exitCode: result.exitCode, filesTouched: inferFiles(command) });
    return result;
  }

  async readFile(path: string): Promise<string> {
    const content = await this.fs.readFile(path);
    await this.record("readFile", path);
    return content;
  }

  async writeFiles(files: Array<{ path: string; content: string | Buffer }>): Promise<void> {
    for (const f of files) {
      const buf = typeof f.content === "string" ? f.content : new Uint8Array(f.content);
      await this.fs.writeFile(f.path, buf);
    }
    await this.record("writeFile", files.map((f) => f.path).join(", "), {
      filesTouched: files.map((f) => f.path),
    });
  }

  private async record(
    kind: "bash" | "readFile" | "writeFile",
    subject: string,
    extra: { filesTouched?: string[]; exitCode?: number } = {},
  ): Promise<void> {
    if (!this.audit) return;
    const snapshotId = this.getSnapshotId ? await this.getSnapshotId() : undefined;
    await this.audit.append(
      makeAuditRecord(this.tenantId, kind, subject, { ...extra, snapshotId }),
    );
  }
}

/** Best-effort extraction of file paths a command likely touches (for audit). */
function inferFiles(command: string): string[] {
  const files = new Set<string>();
  const re = /(?:^|\s)(\/[\w./-]+|\.\/[\w./-]+|[\w.-]+\.(?:ts|js|json|md|py|txt|yml|yaml|toml|sh))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) files.add(m[1]);
  return [...files];
}
