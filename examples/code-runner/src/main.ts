/**
 * Live demo: createTenantHome with javascript:true, then one session turn.
 *
 *   cp .env.sample .env   # set AI_GATEWAY_API_KEY
 *   bun scripts/compile-agent.ts
 *   bun src/main.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SessionTool } from "@socialrobot-io/agent-kit-core";
import {
  createTenantHome,
  defineAgent,
  resetTenantHomeCache,
} from "@socialrobot-io/agent-kit-node";
import { agent } from "./generated/agent.js";

function loadDotEnv(root: string): void {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const root = dirname(fileURLToPath(import.meta.url));
const exampleRoot = join(root, "..");
loadDotEnv(exampleRoot);

const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
if (!apiKey) {
  console.error(
    [
      "Missing AI_GATEWAY_API_KEY.",
      "",
      "Setup:",
      "  cd examples/code-runner",
      "  cp .env.sample .env",
      "  # set AI_GATEWAY_API_KEY=...",
      "  bun scripts/compile-agent.ts",
      "  bun src/main.ts",
      "",
      "Offline smoke (no key): npx nx test code-runner",
    ].join("\n"),
  );
  process.exit(1);
}

const model = process.env.MODEL?.trim() || "anthropic/claude-sonnet-4-5";

const serverTime: SessionTool = {
  name: "server_time",
  description: "Return the host server time as an ISO string.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ now: new Date().toISOString() }),
};

const dataDir = await mkdtemp(join(tmpdir(), "agent-kit-code-runner-"));
resetTenantHomeCache();

const home = await createTenantHome({
  tenantId: "code-runner-demo",
  dataDir,
  agent,
  model,
  definition: defineAgent({
    model,
    config: {
      curator: false,
      writeApproval: { memory: false, skills: false },
    },
  }),
  sandbox: {
    javascript: true,
    // python: true, // enable python3 the same way
  },
  workspaceFiles: {
    "README.md":
      "# Code runner workspace\n\n" +
      "Use `js-exec` for calculations. Example:\n" +
      "`js-exec -c \"console.log(1+2)\"`\n",
  },
  transcripts: false,
});

console.log("=== Code runner demo ===");
console.log(`model=${model}`);
console.log(`volume=${home.volumePath}`);
console.log("sandbox.javascript=true (js-exec enabled)\n");

const session = await home.openSession("demo-1", {
  addTools: [serverTime],
});

const prompt =
  "Using js-exec in the sandbox, compute the sum of 1..10 and tell me the result. " +
  "Show the command you ran.";

console.log("User:", prompt);
console.log("---");

const turn = await session.run([{ role: "user", content: prompt }]);

for (const call of turn.toolCalls) {
  console.log(`tool: ${call.name}`, JSON.stringify(call.args));
}
console.log("\nAssistant:", turn.text);
console.log("\nTip: set sandbox.python: true for python3 the same way.");
