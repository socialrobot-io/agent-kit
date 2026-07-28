/**
 * Append-only audit record for sandbox actions. Each `bash` invocation, file
 * read, and file write inside a tenant's AgentFS volume emits a record so a
 * compliance UI can show what the agent did.
 *
 * Prefer AgentFS built-in timeline for FS/tool_calls. This store is for
 * agent-kit guardrail events and sandbox actions the host wants in JSONL.
 *
 * The store is pluggable: hosts may persist to Postgres; tests use in-memory;
 * local volumes use FileSandboxAuditStore.
 */

export interface SandboxAuditRecord {
  id: string;
  tenantId: string;
  kind: "bash" | "readFile" | "writeFile" | "guardrail_block";
  /** The bash command or file path. */
  subject: string;
  /** Files touched (for bash, best-effort from the command; for writes, the paths). */
  filesTouched?: string[];
  /** AgentFS snapshot id after the action, when available. */
  snapshotId?: string;
  exitCode?: number;
  createdAt: number;
}

export interface SandboxAuditStore {
  append(record: SandboxAuditRecord): Promise<void>;
  list(tenantId: string, limit?: number): Promise<SandboxAuditRecord[]>;
}

let auditCounter = 0;
function auditId(): string {
  auditCounter = (auditCounter + 1) % 0xffffff;
  return `${Date.now().toString(36)}${auditCounter.toString(36)}`;
}

export class InMemorySandboxAuditStore implements SandboxAuditStore {
  private records: SandboxAuditRecord[] = [];

  async append(record: SandboxAuditRecord): Promise<void> {
    this.records.push({ ...record, id: record.id || auditId() });
  }

  async list(tenantId: string, limit = 100): Promise<SandboxAuditRecord[]> {
    return this.records
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

/** Minimal FS for FileSandboxAuditStore. */
export interface AuditFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface FileSandboxAuditStoreOptions {
  fs: AuditFs;
  /** Default path for events. Default `audit/events.jsonl`. */
  path?: string;
}

/**
 * Append-only JSONL audit on the tenant volume (survives with volume backups).
 */
export class FileSandboxAuditStore implements SandboxAuditStore {
  private readonly fs: AuditFs;
  private readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: FileSandboxAuditStoreOptions) {
    this.fs = options.fs;
    this.path = options.path ?? "audit/events.jsonl";
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async append(record: SandboxAuditRecord): Promise<void> {
    return this.runExclusive(async () => {
      const full = { ...record, id: record.id || auditId() };
      const line = `${JSON.stringify(full)}\n`;
      const prev = (await this.fs.readFile(this.path)) ?? "";
      await this.fs.writeFile(this.path, prev + line);
    });
  }

  async list(tenantId: string, limit = 100): Promise<SandboxAuditRecord[]> {
    const raw = await this.fs.readFile(this.path);
    if (!raw?.trim()) return [];
    const out: SandboxAuditRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed) as SandboxAuditRecord;
        if (rec.tenantId === tenantId) out.push(rec);
      } catch {
        // skip
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}

export function makeAuditRecord(
  tenantId: string,
  kind: SandboxAuditRecord["kind"],
  subject: string,
  extra: Partial<SandboxAuditRecord> = {},
): SandboxAuditRecord {
  return { id: auditId(), tenantId, kind, subject, createdAt: Date.now() / 1000, ...extra };
}
