/**
 * Append-only audit record for sandbox actions. Each `bash` invocation, file
 * read, and file write inside a tenant's AgentFS volume emits a record so a
 * compliance UI can show what the agent did and offer snapshot rollback.
 *
 * The store is pluggable: SocialRobot persists to Postgres; tests use the
 * in-memory implementation.
 */

export interface SandboxAuditRecord {
  id: string;
  tenantId: string;
  kind: "bash" | "readFile" | "writeFile";
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

export function makeAuditRecord(
  tenantId: string,
  kind: SandboxAuditRecord["kind"],
  subject: string,
  extra: Partial<SandboxAuditRecord> = {},
): SandboxAuditRecord {
  return { id: auditId(), tenantId, kind, subject, createdAt: Date.now() / 1000, ...extra };
}
