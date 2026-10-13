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
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bghp_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[A-Z0-9]{12,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

/**
 * A password given with its label: "password: …", "password …", "la contraseña es …". The
 * value must have a digit or a symbol, so notes like "password is required"
 * still save. Stripe publishable keys (pk_) are public and not listed.
 */
const LABELED_PASSWORD =
  /\b(?:password|passcode|passwd|contraseña)\b\s*(?:is|es|=|:)?\s*(?=\S*[\d!@#$%^&*_+=?~])\S{6,}/iu;

/**
 * True when text holds a credential a user pasted: an API key or token of a
 * known shape, or a password with its label. Host-configured secrets are not
 * checked here; scrubSecrets redacts those.
 */
export function containsCredential(text: string): boolean {
  return (
    LABELED_PASSWORD.test(text) ||
    STATIC_CREDENTIAL_PATTERNS.some((re) => new RegExp(re.source).test(text))
  );
}

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
