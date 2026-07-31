/**
 * Compile agent trees → importable bundles.
 * Run before next build/dev so the app does not need a runtime agent/ tree.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAgent } from "@socialrobot-io/agent-kit-node";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

const jobs = [
  { dir: join(appRoot, "agent"), outFile: join(appRoot, "src/generated/agent.ts") },
  {
    dir: join(appRoot, "agents/code-runner"),
    outFile: join(appRoot, "src/generated/code-runner-agent.ts"),
  },
] as const;

for (const job of jobs) {
  await compileAgent(job);
  console.log(`compiled ${job.dir} → ${job.outFile}`);
}
