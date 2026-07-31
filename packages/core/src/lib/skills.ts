/**
 * Skills: on-demand procedural knowledge documents (agentskills.io standard).
 *
 * Port of `vendor/hermes/tools/skills_tool.py` and
 * `vendor/hermes/tools/skill_manager_tool.py` (MIT).
 *
 * Skills live under `<home>/skills/` as directories, each with a SKILL.md
 * (YAML frontmatter + body) and optional supporting files under references/,
 * templates/, scripts/, assets/, examples/.
 *
 * Progressive disclosure to minimize token usage:
 *  1. skills_list()  -> compact list of name + description (~3k tokens)
 *  2. skill_view(n)  -> full SKILL.md + a linked_files map
 *  3. skill_view(n, p) -> a specific reference/template/script file
 *
 * skill_manage is the agent's procedural memory writer: when it figures out a
 * non-trivial workflow it saves the approach as a skill for future reuse.
 *
 * Create/edit validation mirrors Hermes (agentskills.io frontmatter rules):
 * required `name` + `description`, name charset/length, description length,
 * non-empty body, and a 60-char prompt-index budget for new skills.
 */

import { firstThreatMessage } from "./threats.js";
import { scrubSecrets } from "./scrub-secrets.js";
import { isSkillNameLocked, parseLockFlags } from "./skill-locks.js";

/** Metadata for one skill directory (from SKILL.md frontmatter + lock state). */
export interface SkillMeta {
  /** Skill folder name; must match agentskills `name`. */
  name: string;
  /** Short trigger description from frontmatter (≤60 chars recommended). */
  description: string;
  /** Optional category label from frontmatter. */
  category?: string;
  /** Optional semver-like version from frontmatter. */
  version?: string;
  /** Optional author from frontmatter. */
  author?: string;
  /** Optional tags from frontmatter. */
  tags?: string[];
  /** Directory holding the skill, relative to the fs root. */
  path: string;
  /** True when the agent (or curator) created this skill at runtime. */
  agentCreated?: boolean;
  /** True for kit-bundled / framework skills (immutable to the agent). */
  bundled?: boolean;
  /** True when frontmatter marks the skill pinned. */
  pinned?: boolean;
  /** True when the skill is locked (frontmatter, `.locked`, or `.locks.json`). */
  locked?: boolean;
}

export interface SkillLibraryOptions {
  /** Host secrets scrubbed before skill content is stored. */
  secrets?: string[];
}

export interface SkillsFs {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile?(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  exists?(path: string): Promise<boolean>;
}

export interface SkillResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

const SKILLS_DIR = "skills";
/** Listed on skill_view (tier 3). */
const SUPPORT_DIRS = ["references", "templates", "scripts", "assets", "examples"] as const;
/** Hermes write_file / remove_file allowlist (agentskills.io support dirs). */
const ALLOWED_WRITE_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);

/** Anthropic / agentskills.io progressive-disclosure limits (Hermes parity). */
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
/** System-prompt skill-index budget for newly created skills (Hermes). */
const SKILL_PROMPT_DESC_LIMIT = 60;
const MAX_SKILL_CONTENT_CHARS = 100_000;
const MAX_SKILL_FILE_BYTES = 1_048_576;

/** Filesystem-safe skill / category names (Hermes VALID_NAME_RE). */
const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  // Tolerate a leading UTF-8 BOM (Windows editors) before the fence.
  const text = content.replace(/^\uFEFF/, "");
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    // Line-based parse (no yaml dep). Values may contain colons; that is the
    // common cross-client frontmatter pitfall agentskills.io calls out.
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return { data, body: text.slice(m[0].length) };
}

/** Validate a skill name / relative file path against traversal. */
function safeRelative(p: string): boolean {
  return !p.includes("..") && !p.startsWith("/") && !p.startsWith("~");
}

function validateName(name: string): string | null {
  if (!name) return "Skill name is required.";
  if (name.length > MAX_NAME_LENGTH) {
    return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  }
  if (!VALID_NAME_RE.test(name) || !safeRelative(name) || name.includes("/")) {
    return (
      `Invalid skill name '${name}'. Use lowercase letters, numbers, ` +
      `hyphens, dots, and underscores. Must start with a letter or digit.`
    );
  }
  return null;
}

function validateCategory(category: string | undefined): string | null {
  if (category == null) return null;
  const trimmed = category.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || !safeRelative(trimmed)) {
    return (
      `Invalid category '${category}'. Use lowercase letters, numbers, ` +
      "hyphens, dots, and underscores. Categories must be a single directory name."
    );
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Category exceeds ${MAX_NAME_LENGTH} characters.`;
  }
  if (!VALID_NAME_RE.test(trimmed)) {
    return (
      `Invalid category '${category}'. Use lowercase letters, numbers, ` +
      "hyphens, dots, and underscores. Categories must be a single directory name."
    );
  }
  return null;
}

/**
 * Validate SKILL.md frontmatter + body (Hermes `_validate_frontmatter`).
 * When `newSkill` is true, also enforce the 60-char prompt-index budget.
 */
function validateFrontmatter(content: string, opts: { newSkill?: boolean; expectName?: string } = {}): string | null {
  if (!content.trim()) return "Content cannot be empty.";
  const text = content.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return "SKILL.md must start with YAML frontmatter (---). See existing skills for format.";
  }
  const endMatch = /\n---\s*\n/.exec(text.slice(3));
  if (!endMatch) {
    return "SKILL.md frontmatter is not closed. Ensure you have a closing '---' line.";
  }

  const { data, body } = parseFrontmatter(text);
  if (!data.name) return "Frontmatter must include 'name' field.";
  if (!data.description) return "Frontmatter must include 'description' field.";

  const nameErr = validateName(data.name);
  if (nameErr) return nameErr;

  if (opts.expectName && data.name !== opts.expectName) {
    return (
      `Frontmatter name '${data.name}' must match the skill directory name ` +
      `'${opts.expectName}' (agentskills.io).`
    );
  }

  const desc = data.description;
  if (desc.length > MAX_DESCRIPTION_LENGTH) {
    return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  if (opts.newSkill && desc.trim().length > SKILL_PROMPT_DESC_LIMIT) {
    return (
      `Description is ${desc.trim().length} chars — new skills must fit the ` +
      `${SKILL_PROMPT_DESC_LIMIT}-char system-prompt budget (one sentence, ` +
      `trigger first, ends with a period). Longer detail belongs in the skill body.`
    );
  }

  if (!body.trim()) {
    return "SKILL.md must have content after the frontmatter (instructions, procedures, etc.).";
  }
  return null;
}

function validateContentSize(content: string, label = "SKILL.md"): string | null {
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    return (
      `${label} content is ${content.length.toLocaleString()} characters ` +
      `(limit: ${MAX_SKILL_CONTENT_CHARS.toLocaleString()}). ` +
      `Consider splitting into a smaller SKILL.md with supporting files ` +
      `in references/ or templates/.`
    );
  }
  return null;
}

/** Hermes `_validate_file_path` for write_file / remove_file / patch targets. */
function validateSupportFilePath(filePath: string): string | null {
  if (!filePath) return "file_path is required.";
  if (!safeRelative(filePath)) return `Invalid file_path '${filePath}'.`;

  const parts = filePath.split("/").filter(Boolean);
  if (parts.some((p) => p === "..")) return "Path traversal ('..') is not allowed.";

  // SKILL.md at skill root (Hermes accepts 'SKILL.md' and '<name>/SKILL.md').
  if (parts[parts.length - 1] === "SKILL.md" && (parts.length === 1 || parts.length === 2)) {
    return null;
  }

  if (!parts.length || !ALLOWED_WRITE_SUBDIRS.has(parts[0])) {
    const allowed = [...ALLOWED_WRITE_SUBDIRS].sort().join(", ");
    return `File must be under one of: ${allowed}. Got: '${filePath}'`;
  }
  if (parts.length < 2) {
    return `Provide a file path, not just a directory. Example: '${parts[0]}/myfile.md'`;
  }
  return null;
}

function descriptionForList(data: Record<string, string>, body: string): string {
  let description = data.description ?? "";
  if (!description) {
    for (const line of body.trim().split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        description = trimmed;
        break;
      }
    }
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `${description.slice(0, MAX_DESCRIPTION_LENGTH - 3)}...`;
  }
  return description;
}

export class SkillLibrary {
  private readonly secrets: string[];

  constructor(
    private readonly fs: SkillsFs,
    private readonly homeDir = "",
    options: SkillLibraryOptions = {},
  ) {
    this.secrets = options.secrets ?? [];
  }

  private get root(): string {
    return this.homeDir ? `${this.homeDir}/${SKILLS_DIR}` : SKILLS_DIR;
  }

  private scrub(content: string): string {
    return scrubSecrets(content, this.secrets);
  }

  /** True when the skill name is locked by registry or protected meta. */
  async isLocked(name: string): Promise<boolean> {
    if (await isSkillNameLocked(this.fs, name, SKILLS_DIR)) return true;
    // Category-nested skills: registry / top-level check missed; use loaded meta.
    const meta = await this.find(name);
    return Boolean(meta?.locked || meta?.pinned || meta?.bundled);
  }

  private lockedError(name: string): SkillResult {
    return {
      success: false,
      error: `Skill '${name}' is locked and cannot be modified by the agent.`,
    };
  }

  private async listDir(dir: string): Promise<string[]> {
    try {
      return await this.fs.list(dir);
    } catch {
      return [];
    }
  }

  private async readMeta(dirPath: string, dirName: string, category?: string): Promise<SkillMeta | null> {
    const raw = await this.fs.readFile(`${dirPath}/SKILL.md`);
    if (raw == null) return null;
    const { data, body } = parseFrontmatter(raw);
    // Lenient load (agentskills.io client guide): prefer frontmatter name, fall
    // back to directory name when missing or mismatched.
    const name = data.name || dirName;
    const flags = parseLockFlags(data);
    return {
      name,
      description: descriptionForList(data, body),
      category: category ?? data.category,
      version: data.version,
      author: data.author,
      path: dirPath,
      ...flags,
    };
  }

  /** List all skills (progressive disclosure tier 1: minimal metadata). */
  async list(category?: string): Promise<{ name: string; description: string; category?: string }[]> {
    const out: { name: string; description: string; category?: string }[] = [];
    const seen = new Set<string>();
    const top = await this.listDir(this.root);
    for (const entry of top) {
      const entryPath = `${this.root}/${entry}`;
      // Could be a skill dir or a category dir.
      const direct = await this.readMeta(entryPath, entry);
      if (direct) {
        if (seen.has(direct.name)) continue;
        if (!category || direct.category === category) {
          seen.add(direct.name);
          out.push({ name: direct.name, description: direct.description, category: direct.category });
        }
        continue;
      }
      // Treat as category: look one level deeper.
      const nested = await this.listDir(entryPath);
      for (const sub of nested) {
        const meta = await this.readMeta(`${entryPath}/${sub}`, sub, entry);
        if (!meta || seen.has(meta.name)) continue;
        if (!category || category === entry) {
          seen.add(meta.name);
          out.push({ name: meta.name, description: meta.description, category: entry });
        }
      }
    }
    return out;
  }

  private async find(name: string): Promise<SkillMeta | null> {
    const top = await this.listDir(this.root);
    for (const entry of top) {
      const entryPath = `${this.root}/${entry}`;
      const direct = await this.readMeta(entryPath, entry);
      if (direct && (direct.name === name || entry === name)) return direct;
      const nested = await this.listDir(entryPath);
      for (const sub of nested) {
        const meta = await this.readMeta(`${entryPath}/${sub}`, sub, entry);
        if (meta && (meta.name === name || sub === name)) return meta;
      }
    }
    return null;
  }

  private async listLinkedFiles(skillPath: string): Promise<Record<string, string[]>> {
    const linked: Record<string, string[]> = {};
    for (const dir of SUPPORT_DIRS) {
      const files = await this.listDir(`${skillPath}/${dir}`);
      if (files.length > 0) linked[dir] = files.map((f) => `${dir}/${f}`);
    }
    return linked;
  }

  /** Load a skill's SKILL.md (tier 2) or a specific linked file (tier 3). */
  async view(name: string, filePath?: string): Promise<SkillResult> {
    const meta = await this.find(name);
    if (!meta) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    if (filePath) {
      if (!safeRelative(filePath)) {
        return { success: false, error: `Invalid file_path '${filePath}'.` };
      }
      const content = await this.fs.readFile(`${meta.path}/${filePath}`);
      if (content == null) {
        return { success: false, error: `File '${filePath}' not found in skill '${name}'.` };
      }
      return { success: true, name: meta.name, file_path: filePath, content };
    }
    const content = await this.fs.readFile(`${meta.path}/SKILL.md`);
    if (content == null) {
      return { success: false, error: `Skill '${name}' has no readable SKILL.md.` };
    }
    const linkedFiles = await this.listLinkedFiles(meta.path);
    return {
      success: true,
      name: meta.name,
      content,
      // Skill directory for resolving relative paths (agentskills.io activation).
      skill_dir: meta.path,
      linked_files: Object.keys(linkedFiles).length ? linkedFiles : null,
    };
  }

  // ── skill_manage actions ────────────────────────────────────────────────

  async create(name: string, content: string, category?: string): Promise<SkillResult> {
    if (!content) return { success: false, error: "content is required for 'create'." };
    if (await this.isLocked(name)) return this.lockedError(name);
    const nameErr = validateName(name);
    if (nameErr) return { success: false, error: nameErr };
    const catErr = validateCategory(category);
    if (catErr) return { success: false, error: catErr };
    content = this.scrub(content);
    const fmErr = validateFrontmatter(content, { newSkill: true, expectName: name });
    if (fmErr) return { success: false, error: fmErr };
    const sizeErr = validateContentSize(content);
    if (sizeErr) return { success: false, error: sizeErr };
    const scanError = firstThreatMessage(content, "strict");
    if (scanError) return { success: false, error: scanError };
    const existing = await this.find(name);
    if (existing) return { success: false, error: `Skill '${name}' already exists. Use 'edit' or 'patch'.` };

    const dirPath = category ? `${this.root}/${category}/${name}` : `${this.root}/${name}`;
    await this.fs.writeFile(`${dirPath}/SKILL.md`, content);
    const result: SkillResult = {
      success: true,
      message: `Created skill '${name}'.`,
      name,
      path: dirPath,
      hint:
        "To add reference files, templates, or scripts, use " +
        `skill_manage(action='write_file', name='${name}', file_path='references/example.md', file_content='...')`,
    };
    if (category) result.category = category;
    return result;
  }

  async edit(name: string, content: string): Promise<SkillResult> {
    if (!content) return { success: false, error: "content is required for 'edit'." };
    if (await this.isLocked(name)) return this.lockedError(name);
    content = this.scrub(content);
    const fmErr = validateFrontmatter(content, { expectName: name });
    if (fmErr) return { success: false, error: fmErr };
    const sizeErr = validateContentSize(content);
    if (sizeErr) return { success: false, error: sizeErr };
    const scanError = firstThreatMessage(content, "strict");
    if (scanError) return { success: false, error: scanError };
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    await this.fs.writeFile(`${meta.path}/SKILL.md`, content);
    return { success: true, message: `Updated skill '${name}'.`, name };
  }

  async patch(
    name: string,
    oldString: string,
    newString: string,
    filePath?: string,
    replaceAll = false,
  ): Promise<SkillResult> {
    if (!oldString) return { success: false, error: "old_string is required for 'patch'." };
    if (await this.isLocked(name)) return this.lockedError(name);
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    const rel = filePath ?? "SKILL.md";
    if (filePath) {
      const pathErr = validateSupportFilePath(rel);
      if (pathErr) return { success: false, error: pathErr };
    } else if (!safeRelative(rel)) {
      return { success: false, error: `Invalid file_path '${rel}'.` };
    }
    const target = `${meta.path}/${rel}`;
    const current = await this.fs.readFile(target);
    if (current == null) return { success: false, error: `File '${rel}' not found in skill '${name}'.` };

    const occurrences = current.split(oldString).length - 1;
    if (occurrences === 0) {
      return { success: false, error: `old_string not found in '${rel}'.` };
    }
    if (occurrences > 1 && !replaceAll) {
      return { success: false, error: `old_string matches ${occurrences} times in '${rel}'. Provide more context or set replace_all=true.` };
    }
    newString = this.scrub(newString);
    const scanError = firstThreatMessage(newString, "strict");
    if (scanError) return { success: false, error: scanError };

    const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
    const sizeErr = validateContentSize(next, rel);
    if (sizeErr) return { success: false, error: sizeErr };
    if (!filePath || rel === "SKILL.md" || rel.endsWith("/SKILL.md")) {
      const fmErr = validateFrontmatter(next, { expectName: name });
      if (fmErr) {
        return { success: false, error: `Patch would break SKILL.md structure: ${fmErr}` };
      }
    }

    await this.fs.writeFile(target, next);
    return { success: true, message: `Patched '${rel}' in skill '${name}'.`, name, file_path: rel };
  }

  async deleteSkill(name: string): Promise<SkillResult> {
    if (await this.isLocked(name)) return this.lockedError(name);
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    if (!this.fs.deleteFile) return { success: false, error: "delete not supported by this fs." };
    await this.fs.deleteFile(`${meta.path}/SKILL.md`);
    return { success: true, message: `Deleted skill '${name}'.`, name };
  }

  async writeFile(name: string, filePath: string, fileContent: string): Promise<SkillResult> {
    const pathErr = validateSupportFilePath(filePath);
    if (pathErr) return { success: false, error: pathErr };
    if (fileContent == null) return { success: false, error: "file_content is required for 'write_file'." };
    if (await this.isLocked(name)) return this.lockedError(name);
    fileContent = this.scrub(fileContent);
    const byteLength = new TextEncoder().encode(fileContent).byteLength;
    if (byteLength > MAX_SKILL_FILE_BYTES) {
      return {
        success: false,
        error:
          `File content is ${byteLength.toLocaleString()} bytes ` +
          `(limit: ${MAX_SKILL_FILE_BYTES.toLocaleString()} bytes / 1 MiB). ` +
          `Consider splitting into smaller files.`,
      };
    }
    const sizeErr = validateContentSize(fileContent, filePath);
    if (sizeErr) return { success: false, error: sizeErr };
    const meta = await this.find(name);
    if (!meta) {
      return { success: false, error: `Skill '${name}' not found. Create it first with action='create'.` };
    }
    const scanError = firstThreatMessage(fileContent, "strict");
    if (scanError) return { success: false, error: scanError };
    await this.fs.writeFile(`${meta.path}/${filePath}`, fileContent);
    return { success: true, message: `Wrote '${filePath}' in skill '${name}'.`, name, file_path: filePath };
  }

  async removeFile(name: string, filePath: string): Promise<SkillResult> {
    const pathErr = validateSupportFilePath(filePath);
    if (pathErr) return { success: false, error: pathErr };
    if (await this.isLocked(name)) return this.lockedError(name);
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    if (!this.fs.deleteFile) return { success: false, error: "delete not supported by this fs." };
    await this.fs.deleteFile(`${meta.path}/${filePath}`);
    return { success: true, message: `Removed '${filePath}' from skill '${name}'.`, name, file_path: filePath };
  }
}
