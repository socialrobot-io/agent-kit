/**
 * Agent-facing filesystem policy: company identity and locked skills are
 * immutable. Hosts seed via the raw (privileged) volume; sessions use this
 * wrapper.
 */

import type { AgentFsLike } from "./agent.js";
import { isSkillNameLocked, SKILL_LOCKS_PATH } from "./skill-locks.js";

export class PathPolicyError extends Error {
  readonly code = "PATH_POLICY_DENIED" as const;
  constructor(message: string) {
    super(message);
    this.name = "PathPolicyError";
  }
}

export interface PathPolicyOptions {
  /** Directory holding SOUL.md / AGENTS.md. Default `agent`. */
  agentDir?: string;
  /** Skills root. Default `skills`. */
  skillsDir?: string;
}

function normalize(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function isUnder(path: string, prefix: string): boolean {
  const p = normalize(path);
  const pre = normalize(prefix);
  return p === pre || p.startsWith(`${pre}/`);
}

/**
 * Wrap a volume FS so agent sessions cannot rewrite company identity or
 * locked skill folders. Reads stay allowed.
 *
 * @param inner - Privileged tenant volume (or any {@link AgentFsLike}).
 * @param options - Agent / skills directory names for the seal.
 */
export function createAgentFs(inner: AgentFsLike, options: PathPolicyOptions = {}): AgentFsLike {
  const agentDir = options.agentDir ?? "agent";
  const skillsDir = options.skillsDir ?? "skills";
  const locksPath = normalize(SKILL_LOCKS_PATH);

  async function assertWritable(path: string): Promise<void> {
    const p = normalize(path);
    if (isUnder(p, agentDir)) {
      throw new PathPolicyError(`path is immutable: '${p}' (company identity)`);
    }
    if (p === locksPath) {
      throw new PathPolicyError(`path is immutable: '${p}' (skill lock registry)`);
    }
    if (isUnder(p, skillsDir)) {
      const rest = p.slice(normalize(skillsDir).length).replace(/^\//, "");
      const skillName = rest.split("/")[0];
      if (skillName && skillName !== ".locks.json") {
        if (await isSkillNameLocked(inner, skillName, skillsDir)) {
          throw new PathPolicyError(`skill is locked: '${skillName}'`);
        }
      }
    }
  }

  const wrapped: AgentFsLike = {
    readFile: (path) => inner.readFile(path),
    list: (dir) => inner.list(dir),
    async writeFile(path, content) {
      await assertWritable(path);
      await inner.writeFile(path, content);
    },
  };

  if (inner.deleteFile) {
    wrapped.deleteFile = async (path: string) => {
      await assertWritable(path);
      await inner.deleteFile!(path);
    };
  }

  return wrapped;
}
