/**
 * Command guardrails for the agent bash layer.
 *
 * Intercepts every `bash` command before execution (wired to bash-tool's
 * `onBeforeBashCall`). Blocks destructive patterns, credential exfiltration,
 * and non-allowlisted network egress; redacts secrets from the command line.
 * Complements @socialrobot-io/agent-kit-core threat scanning, which guards content that
 * enters the system prompt — this guards actions inside the sandbox.
 */

export interface GuardrailDecision {
  /** The (possibly modified) command to run. Absent when blocked. */
  command?: string;
  /** When present, the command is blocked with this reason. */
  blocked?: string;
  /** Non-fatal warnings to log. */
  warnings?: string[];
}

export interface GuardrailOptions {
  /** Hosts the agent may reach over the network. Empty = no network egress. */
  allowedHosts?: string[];
  /** Extra substrings that block a command outright. */
  blockedPatterns?: RegExp[];
  /** Secrets to redact from the command before execution/logging. */
  secrets?: string[];
}

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+\/\s*($|["';|&])/i, // rm -rf /
  /\brm\s+-[a-z]*f[a-z]*\s+~\//i, // rm -rf ~/
  /\bmkfs\b/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /:\(\)\s*\{\s*:\|:\&\s*\};:/, // fork bomb
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  />\s*\/dev\/sd[a-z]/i, // write to block device
];

const EXFIL: RegExp[] = [
  /\b(curl|wget|nc|ncat)\b[^\n]*(\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\w*\}?)/i,
  /\b(cat|head|less|more|tail)\b[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.ssh\/id_)/i,
  /\b(authorized_keys)\b/i,
  /\bbase64\b[^\n]*\|\s*(curl|wget|nc)\b/i,
];

/** Match hostnames in URLs or bare curl/wget host args. */
const URL_RE = /\b(?:https?|ftp):\/\/([a-z0-9.-]+)(?::\d+)?/gi;
const BARE_HOST_RE = /\b(?:curl|wget)\s+(?:-[^\s]+\s+)*([a-z0-9.-]+\.[a-z]{2,})(?:\/|\s|$)/gi;

function redactSecrets(command: string, secrets: string[]): string {
  // Keep in sync with @socialrobot-io/agent-kit-core scrubSecrets (leaf: no core dep).
  let out = command;
  for (const s of secrets) {
    if (s) out = out.split(s).join("***REDACTED***");
  }
  const staticPatterns: RegExp[] = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bghp_[A-Za-z0-9_]{20,}\b/g,
    /\bAKIA[A-Z0-9]{12,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  ];
  for (const re of staticPatterns) {
    out = out.replace(new RegExp(re.source, re.flags), "***REDACTED***");
  }
  return out;
}

/** Scrub secrets from tool output (stdout/stderr / file reads). */
export function scrubToolOutput(text: string, secrets: readonly string[] = []): string {
  return redactSecrets(text, [...secrets]);
}

function extractHosts(command: string): string[] {
  const hosts: string[] = [];
  let m: RegExpExecArray | null;
  const urlRe = new RegExp(URL_RE);
  while ((m = urlRe.exec(command)) !== null) hosts.push(m[1].toLowerCase());
  const bareRe = new RegExp(BARE_HOST_RE);
  while ((m = bareRe.exec(command)) !== null) hosts.push(m[1].toLowerCase());
  return hosts;
}

/**
 * Evaluate a bash command. Returns a decision: block it, or proceed with a
 * possibly redacted/modified command plus warnings.
 */
export function evaluateCommand(command: string, options: GuardrailOptions = {}): GuardrailDecision {
  const { allowedHosts = [], blockedPatterns = [], secrets = [] } = options;
  const warnings: string[] = [];

  for (const re of DESTRUCTIVE) {
    if (re.test(command)) {
      return { blocked: `Blocked destructive command (pattern: ${re.source}).` };
    }
  }
  for (const re of EXFIL) {
    if (re.test(command)) {
      return { blocked: `Blocked potential credential exfiltration (pattern: ${re.source}).` };
    }
  }
  for (const re of blockedPatterns) {
    if (re.test(command)) {
      return { blocked: `Blocked by tenant policy (pattern: ${re.source}).` };
    }
  }

  // Network egress allowlist.
  const hosts = extractHosts(command);
  for (const host of hosts) {
    const allowed = allowedHosts.some((h) => host === h || host.endsWith("." + h));
    if (!allowed) {
      return { blocked: `Blocked network egress to non-allowlisted host '${host}'.` };
    }
  }

  const redacted = redactSecrets(command, secrets);
  const result: GuardrailDecision = { command: redacted };
  if (warnings.length) result.warnings = warnings;
  return result;
}

/** bash-tool `onBeforeBashCall` adapter. Throws to block, returns to modify. */
export function makeBeforeBashCall(options: GuardrailOptions = {}) {
  return ({ command }: { command: string }): { command: string } => {
    const decision = evaluateCommand(command, options);
    if (decision.blocked) {
      // Return a command that echoes the block reason and exits non-zero
      // rather than throwing, so the agent sees the message on stderr.
      const msg = decision.blocked.replace(/"/g, '\\"');
      return { command: `echo "${msg}" >&2; exit 1` };
    }
    return { command: decision.command ?? command };
  };
}
