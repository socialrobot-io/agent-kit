/**
 * Scrub configured secrets and common credential-shaped tokens from text
 * before it reaches the model or durable memory/skills.
 *
 * Sandbox mirrors this logic in guardrails (leaf packages cannot import core).
 * Keep both implementations in sync when changing patterns.
 */

/** Exact substrings to replace, plus common API-key shapes. */
const STATIC_CREDENTIAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

const REDACTED = "***REDACTED***";

export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join(REDACTED);
  }
  for (const re of STATIC_CREDENTIAL_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), REDACTED);
  }
  return out;
}
