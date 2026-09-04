/**
 * Load and compile host agent directories.
 *
 * Layout (one folder per agent):
 *   agents/chat/
 *     SOUL.md
 *     AGENTS.md
 *     skills/<name>/...
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import type { AgentBundle, SkillSeed } from "@socialrobot-io/agent-kit-core";

/** Env key set by `withAgentKit` so runtime names match Next tracing. */
export const AGENT_KIT_AGENTS_DIR_ENV = "AGENT_KIT_AGENTS_DIR";

/** Default agents root under the app (`agents/<name>`). */
export const DEFAULT_AGENTS_DIR = "agents";

/** Legacy single-agent folder for {@link compileAgent} when `dir` is omitted. */
const DEFAULT_COMPILE_AGENT_DIR = "agent";

function normalizeAgentsDir(dir: string): string {
  return dir.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Agents root relative to cwd (`AGENT_KIT_AGENTS_DIR` or `agents`). */
export function resolveAgentsDir(): string {
  const fromEnv = process.env[AGENT_KIT_AGENTS_DIR_ENV];
  return normalizeAgentsDir(fromEnv && fromEnv.trim() ? fromEnv : DEFAULT_AGENTS_DIR);
}

/**
 * Resolve a `loadAgent` argument to an absolute path.
 *
 * - Bare name (`"chat"`) → `{agentsDir}/chat` (see {@link resolveAgentsDir})
 * - Relative path (`"agents/chat"`, `"src/agents/chat"`) → under cwd
 * - Absolute path → unchanged
 */
export function resolveAgentPath(nameOrPath: string): string {
  if (!nameOrPath?.trim()) {
    throw new Error('loadAgent requires an agent name (e.g. "chat") or a directory path');
  }
  if (isAbsolute(nameOrPath)) return nameOrPath;
  const normalized = nameOrPath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.includes("/")) {
    return join(process.cwd(), normalized);
  }
  return join(process.cwd(), resolveAgentsDir(), normalized);
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

async function loadSkillFolder(skillDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`skill folder not found: ${skillDir}`);
      throw err;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(skillDir, abs).split(sep).join("/");
      files[rel] = await readFile(abs, "utf8");
    }
  }

  const st = await stat(skillDir);
  if (!st.isDirectory()) throw new Error(`skill path is not a directory: ${skillDir}`);
  await walk(skillDir);
  return files;
}

async function listSkillDirs(skillsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
}

async function loadAgentAt(root: string): Promise<AgentBundle> {
  const soul = await readOptional(join(root, "SOUL.md"));
  const agentsMd = await readOptional(join(root, "AGENTS.md"));
  const skills: SkillSeed[] = [];

  for (const name of await listSkillDirs(join(root, "skills"))) {
    const files = await loadSkillFolder(join(root, "skills", name));
    if (!files["SKILL.md"] && !Object.keys(files).some((k) => k.endsWith("/SKILL.md"))) {
      throw new Error(`skill '${name}' has no SKILL.md under ${join(root, "skills", name)}`);
    }
    skills.push({ name, files, tier: "agent" });
  }

  if (!soul && !agentsMd && skills.length === 0) {
    throw new Error(`loadAgent found nothing under '${root}'`);
  }

  return { soul, agentsMd, skills };
}

/**
 * Load an agent folder into an {@link AgentBundle}.
 *
 * Prefer a bare agent name. The folder is `{agentsDir}/{name}` where
 * `agentsDir` defaults to `agents`, or `AGENT_KIT_AGENTS_DIR` when set
 * (Next: `withAgentKit` sets this to match file tracing).
 *
 * ```ts
 * const chat = await loadAgent("chat");
 * const runner = await loadAgent("code-runner");
 * ```
 *
 * Paths still work: `"agents/chat"`, `"src/agents/chat"`, or an absolute path
 * (tests / custom layouts).
 *
 * @param nameOrPath - Agent name under `agents/`, or a directory path.
 * @returns Bundle for {@link createTenantHome} / {@link installAgent}.
 */
export async function loadAgent(nameOrPath: string): Promise<AgentBundle> {
  return loadAgentAt(resolveAgentPath(nameOrPath));
}

export interface CompileAgentOptions {
  /** Agent authoring directory (path). Default `agent` under the app root. */
  dir?: string;
  /**
   * Output path. `.ts` / `.js` → module exporting `agent`.
   * `.json` → JSON document.
   */
  outFile: string;
}

function emitTypeScript(bundle: AgentBundle): string {
  const body = JSON.stringify(bundle, null, 2);
  return (
    "/* AUTO-GENERATED by compileAgent — do not edit. */\n" +
    "import type { AgentBundle } from \"@socialrobot-io/agent-kit-core\";\n\n" +
    `export const agent = ${body} as const satisfies AgentBundle;\n` +
    "export default agent;\n"
  );
}

/**
 * Write an agent folder to an importable module (advanced / no `agents/` on disk).
 *
 * Prefer {@link loadAgent} for normal apps.
 *
 * @param opts - Source directory and output module path.
 * @returns The compiled {@link AgentBundle} (also written to `outFile`).
 */
export async function compileAgent(opts: CompileAgentOptions): Promise<AgentBundle> {
  if (!opts.outFile?.trim()) throw new Error("compileAgent requires outFile");
  const dir = opts.dir ?? DEFAULT_COMPILE_AGENT_DIR;
  const root = isAbsolute(dir) ? dir : join(process.cwd(), dir.replace(/^\.\//, ""));
  const bundle = await loadAgentAt(root);
  const ext = extname(opts.outFile).toLowerCase();
  let contents: string;
  if (ext === ".json") {
    contents = `${JSON.stringify(bundle, null, 2)}\n`;
  } else if (ext === ".ts" || ext === ".mts" || ext === ".cts" || ext === ".js" || ext === ".mjs") {
    contents = emitTypeScript(bundle);
  } else {
    throw new Error(`compileAgent: unsupported outFile extension '${ext}' (use .ts, .js, or .json)`);
  }
  await mkdir(dirname(opts.outFile), { recursive: true });
  await writeFile(opts.outFile, contents, "utf8");
  return bundle;
}
