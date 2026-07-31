/**
 * Compile agent/ → importable bundle.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAgent } from "@socialrobot-io/agent-kit-node";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

await compileAgent({
  dir: join(appRoot, "agent"),
  outFile: join(appRoot, "src/generated/agent.ts"),
});
console.log(`compiled ${join(appRoot, "agent")} → ${join(appRoot, "src/generated/agent.ts")}`);
