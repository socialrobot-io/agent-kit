/**
 * Shared threat-pattern library for context-window security scanning.
 *
 * Port of `vendor/hermes/tools/threat_patterns.py` (MIT). Single source of
 * truth for prompt-injection / promptware / exfiltration patterns used by the
 * memory writer, the context assembler, and the tool-result delimiter system.
 *
 * Patterns are organized by ATTACK CLASS. Each is a `[regex, patternId, scope]`
 * tuple where scope controls which scanners use it:
 *  - "all"     -> classic prompt injection + exfiltration (minimal false positives)
 *  - "context" -> adds promptware / C2 / role-play (context files, memory, tool results)
 *  - "strict"  -> adds persistence / SSH backdoor / exfil-URL (memory writes, skill installs)
 */

export type ThreatScope = "all" | "context" | "strict";

/** Hard cap on text scanned with regexes (bounds worst-case runtime). */
export const MAX_SCAN_CHARS = 65_536;

/**
 * Bounded filler between key attack words. Earlier patterns used an ambiguous
 * unbounded repetition that could backtrack heavily on adversarial near-misses.
 * Eight filler words is enough for the intended obfuscation bypasses.
 */
const FILLER = String.raw`(?:\w+\s+){0,8}`;

type RawPattern = [regex: string, patternId: string, scope: ThreatScope];

const PATTERNS: RawPattern[] = [
  // Classic prompt injection (applies everywhere)
  [String.raw`ignore\s+${FILLER}(previous|all|above|prior)\s+${FILLER}instructions`, "prompt_injection", "all"],
  [String.raw`system\s+prompt\s+override`, "sys_prompt_override", "all"],
  [String.raw`disregard\s+${FILLER}(your|all|any)\s+${FILLER}(instructions|rules|guidelines)`, "disregard_rules", "all"],
  [String.raw`act\s+as\s+(if|though)\s+${FILLER}you\s+${FILLER}(have\s+no|don't\s+have)\s+${FILLER}(restrictions|limits|rules)`, "bypass_restrictions", "all"],
  [String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, "html_comment_injection", "all"],
  [String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, "hidden_div", "all"],
  [String.raw`translate\s+[^\n]{0,512}\s+into\s+[^\n]{0,512}\s+and\s+(execute|run|eval)`, "translate_execute", "all"],
  [String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, "deception_hide", "all"],

  // Role-play / identity hijack (context + strict)
  [String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`, "role_hijack", "context"],
  [String.raw`pretend\s+${FILLER}(you\s+are|to\s+be)\s+`, "role_pretend", "context"],
  [String.raw`output\s+${FILLER}(system|initial)\s+prompt`, "leak_system_prompt", "context"],
  [String.raw`(respond|answer|reply)\s+without\s+${FILLER}(restrictions|limitations|filters|safety)`, "remove_filters", "context"],
  [String.raw`you\s+have\s+been\s+${FILLER}(updated|upgraded|patched)\s+to`, "fake_update", "context"],
  [String.raw`\bname\s+yourself\s+\w+`, "identity_override", "context"],

  // C2 / Brainworm-style promptware (context scope)
  [String.raw`register\s+(as\s+)?a?\s*node`, "c2_node_registration", "context"],
  [String.raw`(heartbeat|beacon|check[\s\-]?in)\s+(to|with)\s+`, "c2_heartbeat", "context"],
  [String.raw`pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b`, "c2_task_pull", "context"],
  [String.raw`connect\s+to\s+the\s+network\b`, "c2_network_connect", "context"],
  [String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`, "forced_action", "context"],
  [String.raw`only\s+use\s+one[\s\-]?liners?\b`, "anti_forensic_oneliner", "context"],
  [String.raw`never\s+${FILLER}(?:create|write)\s+${FILLER}(?:script|file)\s+${FILLER}disk`, "anti_forensic_disk", "context"],
  [String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\w*`, "env_var_unset_agent", "context"],

  // Known C2 / red-team framework names
  [String.raw`\b(?:cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b`, "known_c2_framework", "context"],
  [String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, "c2_explicit", "context"],
  [String.raw`\bcommand\s+and\s+control\b`, "c2_explicit_long", "context"],

  // Exfiltration via curl/wget/cat with secrets (applies everywhere)
  [String.raw`curl\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`, "exfil_curl", "all"],
  [String.raw`wget\s+[^\n]{0,2048}\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)`, "exfil_wget", "all"],
  [String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, "read_secrets", "all"],
  [String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\s+(to|at)\s+https?://`, "send_to_url", "strict"],
  [String.raw`(include|output|print|share)\s+${FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`, "context_exfil", "strict"],

  // Persistence / SSH backdoor (strict scope)
  [String.raw`authorized_keys`, "ssh_backdoor", "strict"],
  [String.raw`\$HOME/\.ssh|\~/\.ssh`, "ssh_access", "strict"],
  [String.raw`\$HOME/\.hermes/\.env|\~/\.hermes/\.env`, "hermes_env", "strict"],
  [String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)`, "agent_config_mod", "strict"],
  [String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}\.hermes/(config\.yaml|SOUL\.md)`, "hermes_config_mod", "strict"],

  // Hardcoded secrets
  [String.raw`(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}`, "hardcoded_secret", "strict"],
];

/** Invisible / bidirectional unicode characters used in injection attacks. */
export const INVISIBLE_CHARS: ReadonlySet<string> = new Set([
  "​", // zero-width space
  "‌", // zero-width non-joiner
  "‍", // zero-width joiner
  "⁠", // word joiner
  "⁢", // invisible times
  "⁣", // invisible separator
  "⁤", // invisible plus
  "﻿", // zero-width no-break space (BOM)
  "‪", // left-to-right embedding
  "‫", // right-to-left embedding
  "‬", // pop directional formatting
  "‭", // left-to-right override
  "‮", // right-to-left override
  "⁦", // left-to-right isolate
  "⁧", // right-to-left isolate
  "⁨", // first strong isolate
  "⁩", // pop directional isolate
]);

type Compiled = [regex: RegExp, patternId: string];

function compileScopes(): Record<ThreatScope, Compiled[]> {
  const all: Compiled[] = [];
  const context: Compiled[] = [];
  const strict: Compiled[] = [];

  for (const [pattern, pid, scope] of PATTERNS) {
    const entry: Compiled = [new RegExp(pattern, "i"), pid];
    if (scope === "all") {
      all.push(entry);
      context.push(entry);
      strict.push(entry);
    } else if (scope === "context") {
      context.push(entry);
      strict.push(entry);
    } else if (scope === "strict") {
      strict.push(entry);
    } else {
      throw new Error(`threats: unknown scope ${scope} for pattern ${pid}`);
    }
  }
  return { all, context, strict };
}

const COMPILED = compileScopes();

/**
 * Return matched pattern IDs in `content` at the given scope. Also detects
 * invisible unicode characters (returned as `invisible_unicode_U+XXXX`).
 */
export function scanForThreats(content: string, scope: ThreatScope = "context"): string[] {
  if (!content) return [];

  const findings: string[] = [];
  const bounded = content.slice(0, MAX_SCAN_CHARS);

  // Invisible unicode on the RAW content (before NFKC can strip codepoints).
  for (const ch of new Set(bounded)) {
    if (INVISIBLE_CHARS.has(ch)) {
      findings.push(`invisible_unicode_U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }

  // NFKC folds full-width / compatibility variants to ASCII before regex.
  const normalised = bounded.normalize("NFKC");

  for (const [compiled, pid] of COMPILED[scope]) {
    if (compiled.test(normalised)) findings.push(pid);
  }
  return findings;
}

/**
 * Return a human-readable error string for the first threat found, or null.
 * Used by paths that block on the first hit (memory writes, skill installs).
 */
export function firstThreatMessage(content: string, scope: ThreatScope = "strict"): string | null {
  const findings = scanForThreats(content, scope);
  if (findings.length === 0) return null;
  const pid = findings[0];
  if (pid.startsWith("invisible_unicode_")) {
    const codepoint = pid.replace("invisible_unicode_", "");
    return `Blocked: content contains invisible unicode character ${codepoint} (possible injection).`;
  }
  return (
    `Blocked: content matches threat pattern '${pid}'. ` +
    `Content is injected into the system prompt and must not contain ` +
    `injection or exfiltration payloads.`
  );
}
