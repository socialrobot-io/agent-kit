import { defineAgent, type SessionTool } from "@socialrobot-io/agent-kit-core";
import { createAgentKit } from "@socialrobot-io/agent-kit-node";
import { resolveLiveModel } from "./env";
import { examplePackageRoot } from "./seed";
import { agent } from "../generated/code-runner-agent";
import { join } from "node:path";

/** Demo tool: returns host server time. Registered per session via addTools. */
export const serverTime: SessionTool = {
  name: "server_time",
  description: "Return the host server time as an ISO string.",
  inputSchema: { type: "object", properties: {} },
  execute: async () => ({ now: new Date().toISOString() }),
};

const root = await examplePackageRoot();
const live = resolveLiveModel();

export const CODE_RUNNER_TENANT_ID = "code-runner-demo";
export const CODE_RUNNER_DEMO_SECRET = "sk-demo-code-runner-not-real";

export const codeRunnerKit = createAgentKit({
  agent,
  model: live.model,
  volumePath: join(root, ".agentfs", "code-runner.db"),
  definition: defineAgent({ model: live.label, config: { curator: false } }),
  sandbox: { javascript: true, secrets: [CODE_RUNNER_DEMO_SECRET] },
  workspaceFiles: {
    "README.md": "# Code runner workspace\nUse `js-exec` for calculations.\n",
  },
});
