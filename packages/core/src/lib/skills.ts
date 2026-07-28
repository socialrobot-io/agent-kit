/**
 * Skills: on-demand procedural knowledge documents (agentskills.io standard).
 *
 * TypeScript port of Nous Research Hermes Agent `tools/skills_tool.py` and
 * `tools/skill_manager_tool.py` (MIT).
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
 */

import { firstThreatMessage } from "./threats.js";

export interface SkillMeta {
  name: string;
  description: string;
  category?: string;
  version?: string;
  author?: string;
  tags?: string[];
  /** Directory holding the skill, relative to the fs root. */
  path: string;
  /** Provenance: who may edit it. */
  agentCreated?: boolean;
  bundled?: boolean;
  pinned?: boolean;
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
const SUPPORT_DIRS = ["references", "templates", "scripts", "assets", "examples"];

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (!m) return { data: {}, body: content };
  const data: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return { data, body: content.slice(m[0].length) };
}

/** Validate a skill name / relative file path against traversal. */
function safeRelative(p: string): boolean {
  return !p.includes("..") && !p.startsWith("/") && !p.startsWith("~");
}

export class SkillLibrary {
  constructor(
    private readonly fs: SkillsFs,
    private readonly homeDir = "",
  ) {}

  private get root(): string {
    return this.homeDir ? `${this.homeDir}/${SKILLS_DIR}` : SKILLS_DIR;
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
    const { data } = parseFrontmatter(raw);
    const name = data.name || dirName;
    return {
      name,
      description: data.description ?? "",
      category: category ?? data.category,
      version: data.version,
      author: data.author,
      path: dirPath,
    };
  }

  /** List all skills (progressive disclosure tier 1: minimal metadata). */
  async list(category?: string): Promise<{ name: string; description: string; category?: string }[]> {
    const out: { name: string; description: string; category?: string }[] = [];
    const top = await this.listDir(this.root);
    for (const entry of top) {
      const entryPath = `${this.root}/${entry}`;
      // Could be a skill dir or a category dir.
      const direct = await this.readMeta(entryPath, entry);
      if (direct) {
        if (!category || direct.category === category) {
          out.push({ name: direct.name, description: direct.description, category: direct.category });
        }
        continue;
      }
      // Treat as category: look one level deeper.
      const nested = await this.listDir(entryPath);
      for (const sub of nested) {
        const meta = await this.readMeta(`${entryPath}/${sub}`, sub, entry);
        if (meta && (!category || category === entry)) {
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
      linked_files: Object.keys(linkedFiles).length ? linkedFiles : null,
    };
  }

  // ── skill_manage actions ────────────────────────────────────────────────

  async create(name: string, content: string, category?: string): Promise<SkillResult> {
    if (!content) return { success: false, error: "content is required for 'create'." };
    if (!safeRelative(name)) return { success: false, error: `Invalid skill name '${name}'.` };
    const scanError = firstThreatMessage(content, "strict");
    if (scanError) return { success: false, error: scanError };
    const existing = await this.find(name);
    if (existing) return { success: false, error: `Skill '${name}' already exists. Use 'edit' or 'patch'.` };

    const dirPath = category ? `${this.root}/${category}/${name}` : `${this.root}/${name}`;
    await this.fs.writeFile(`${dirPath}/SKILL.md`, content);
    return { success: true, message: `Created skill '${name}'.`, name, category };
  }

  async edit(name: string, content: string): Promise<SkillResult> {
    if (!content) return { success: false, error: "content is required for 'edit'." };
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
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    const rel = filePath ?? "SKILL.md";
    if (!safeRelative(rel)) return { success: false, error: `Invalid file_path '${rel}'.` };
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
    const scanError = firstThreatMessage(newString, "strict");
    if (scanError) return { success: false, error: scanError };

    const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
    await this.fs.writeFile(target, next);
    return { success: true, message: `Patched '${rel}' in skill '${name}'.`, name, file_path: rel };
  }

  async deleteSkill(name: string): Promise<SkillResult> {
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    if (!this.fs.deleteFile) return { success: false, error: "delete not supported by this fs." };
    await this.fs.deleteFile(`${meta.path}/SKILL.md`);
    return { success: true, message: `Deleted skill '${name}'.`, name };
  }

  async writeFile(name: string, filePath: string, fileContent: string): Promise<SkillResult> {
    if (!filePath) return { success: false, error: "file_path is required for 'write_file'." };
    if (!safeRelative(filePath)) return { success: false, error: `Invalid file_path '${filePath}'.` };
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
    if (!filePath) return { success: false, error: "file_path is required for 'remove_file'." };
    if (!safeRelative(filePath)) return { success: false, error: `Invalid file_path '${filePath}'.` };
    const meta = await this.find(name);
    if (!meta) return { success: false, error: `Skill '${name}' not found.` };
    if (!this.fs.deleteFile) return { success: false, error: "delete not supported by this fs." };
    await this.fs.deleteFile(`${meta.path}/${filePath}`);
    return { success: true, message: `Removed '${filePath}' from skill '${name}'.`, name, file_path: filePath };
  }
}
