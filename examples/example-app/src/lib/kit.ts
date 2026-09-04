import { createAgentKit } from "@socialrobot-io/agent-kit-node";
import { resolveLiveModel } from "./env";
import { examplePackageRoot } from "./seed";
import { agent } from "../generated/agent";
import { join } from "node:path";

const root = await examplePackageRoot();
const live = resolveLiveModel();

export const TENANT_ID = "demo-user";

export const chatKit = createAgentKit({
  agent,
  model: live.model,
  volumePath: join(root, ".agentfs", "example.db"),
  workspaceFiles: {
    "README.md": "# Sandbox workspace\nTry: `ls`, `cat README.md`.\n",
    "notes/todo.txt": "- try bash\n",
  },
});
