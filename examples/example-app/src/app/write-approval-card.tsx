"use client";

import styles from "./page.module.css";

/**
 * Approve / Deny card for memory and skill_manage writes.
 * Rendered when AI SDK tool parts are in `approval-requested` state.
 */
export function WriteApprovalCard({
  toolName,
  input,
  onApprove,
  onDeny,
}: {
  toolName: string;
  input: unknown;
  onApprove: () => void;
  onDeny: () => void;
}) {
  return (
    <div className={`${styles.tool} ${styles.approvalCard}`} role="group" aria-label="Write approval">
      <div className={styles.toolHead}>
        <span>{toolName}</span>
        <span className={styles.approvalBadge}>needs your approval</span>
      </div>
      <p className={styles.approvalCopy}>
        This write changes durable agent state. Approve to apply it, or deny to
        leave things unchanged.
      </p>
      <div className={styles.toolBody}>{JSON.stringify(input ?? {}, null, 2)}</div>
      <div className={styles.approvalRow}>
        <button type="button" className={styles.approve} onClick={onApprove}>
          Approve
        </button>
        <button type="button" className={styles.deny} onClick={onDeny}>
          Deny
        </button>
      </div>
    </div>
  );
}
