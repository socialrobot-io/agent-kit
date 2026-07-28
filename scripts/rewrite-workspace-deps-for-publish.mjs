#!/usr/bin/env bun
/**
 * Replace `workspace:*` with concrete versions in publishable package.json
 * files so npm accepts the tarball. Run after `nx release version` and before
 * `nx release publish`. Do not commit the result; local installs keep
 * `workspace:*`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "ai", "sessions", "sandbox", "curator", "cli"];
const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const versions = {};
for (const dir of PACKAGES) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
  versions[pkg.name] = pkg.version;
}

let rewritten = 0;
for (const dir of PACKAGES) {
  const path = join(ROOT, "packages", dir, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  let changed = false;

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (range !== "workspace:*") continue;
      const version = versions[name];
      if (!version) {
        throw new Error(`${pkg.name}: ${field}.${name} is workspace:* but no version map entry`);
      }
      deps[name] = version;
      changed = true;
      rewritten += 1;
    }
  }

  if (changed) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`rewrote workspace deps in packages/${dir}/package.json -> ${pkg.version}`);
  }
}

if (rewritten === 0) {
  console.log("no workspace:* deps to rewrite");
} else {
  console.log(`rewrote ${rewritten} workspace:* reference(s)`);
}
