/**
 * In-memory filesystem implementing the core Fs contracts. Used for tests,
 * local dev, and as the reference adapter; the production adapter is backed by
 * a per-tenant AgentFS volume (see @socialrobot-io/agent-kit-sandbox).
 *
 * Paths are POSIX-style, "/" is the agent home. Directories are implicit.
 */

export class InMemoryFs {
  private files = new Map<string, string>();

  private normalize(path: string): string {
    // Strip leading/trailing '/' without regex (avoids js/polynomial-redos).
    let start = 0;
    let end = path.length;
    while (start < end && path.charCodeAt(start) === 47 /* / */) start++;
    while (end > start && path.charCodeAt(end - 1) === 47) end--;
    return path.slice(start, end);
  }

  async readFile(path: string): Promise<string | null> {
    const p = this.normalize(path);
    return this.files.has(p) ? (this.files.get(p) as string) : null;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(this.normalize(path), content);
  }

  async deleteFile(path: string): Promise<void> {
    const p = this.normalize(path);
    // Delete the file, or everything under it if it's a directory prefix.
    if (this.files.delete(p)) return;
    const prefix = p + "/";
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }

  async list(dir: string): Promise<string[]> {
    const p = this.normalize(dir);
    const prefix = p === "" ? "" : p + "/";
    const children = new Set<string>();
    for (const key of this.files.keys()) {
      if (prefix === "" ) {
        children.add(key.split("/")[0]);
        continue;
      }
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        children.add(rest.split("/")[0]);
      }
    }
    return [...children];
  }

  async exists(path: string): Promise<boolean> {
    const p = this.normalize(path);
    if (this.files.has(p)) return true;
    const prefix = p + "/";
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  /** Test helper: snapshot all files. */
  dump(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
