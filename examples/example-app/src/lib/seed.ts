/**
 * Resolve the example-app package root (the folder containing `agents/`).
 * Used to place the tenant SQLite volume under `.agentfs/`.
 */

import { access } from "node:fs/promises";
import { join } from "node:path";

const AGENTS_DIR = "agents";

async function resolvePackageRoot(): Promise<string> {
  const candidates = [process.cwd(), join(process.cwd(), "examples/example-app")];
  for (const root of candidates) {
    try {
      await access(join(root, AGENTS_DIR, "chat", "SOUL.md"));
      return root;
    } catch {
      // try next
    }
  }
  return process.cwd();
}

export async function examplePackageRoot(): Promise<string> {
  return resolvePackageRoot();
}
