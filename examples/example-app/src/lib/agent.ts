/**
 * Process-wide agent runtime over a persistent AgentFS volume + bash-tool sandbox.
 * Survives Next.js hot reloads via globalThis.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { AgentFS } from "agentfs-sdk";
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";
import { createTenantBashToolkit, type TenantBashToolkit } from "@agent-kit/sandbox";
import type { LanguageModel } from "ai";
import { adaptAgentFs } from "./fs-adapter";
import { examplePackageRoot, seedAgentHome } from "./seed";
import { resolveLiveModel, type LiveModel } from "./env";

type AgentKitState = {
  afs: AgentFS;
  runtime: AgentSessionRuntime;
  live: LiveModel;
  bash: TenantBashToolkit;
};

declare global {
  // eslint-disable-next-line no-var
  var __agentKitExample: AgentKitState | undefined;
}

const WORKSPACE_FILES: Record<string, string> = {
  "README.md":
    "# Sandbox workspace\n\nIsolated just-bash volume for this demo tenant.\n" +
    "Try: `ls`, `cat README.md`, or write a short note with writeFile.\n",
  "notes/todo.txt": "- try bash\n- ask the agent to summarize this file\n",
};

export async function getAgent(): Promise<{
  runtime: AgentSessionRuntime;
  model: LanguageModel;
  label: string;
  provider: LiveModel["provider"];
  bashTools: ToolSet;
  bash: TenantBashToolkit;
}> {
  if (globalThis.__agentKitExample) {
    const s = globalThis.__agentKitExample;
    return {
      runtime: s.runtime,
      model: s.live.model,
      label: s.live.label,
      provider: s.live.provider,
      bashTools: s.bash.tools as unknown as ToolSet,
      bash: s.bash,
    };
  }

  const live = resolveLiveModel();
  const root = await examplePackageRoot();
  const volumeDir = join(root, ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });

  const afs = await AgentFS.open({ path: volumePath });
  const fs = adaptAgentFs(afs.fs);
  await seedAgentHome(fs);

  const definition = defineAgent({
    model: live.label,
    config: {
      writeApproval: { memory: false, skills: false },
      sandboxEnabled: true,
    },
  });

  const runtime = new AgentSessionRuntime({
    tenantId: "demo-user",
    fs,
    definition,
    origin: "foreground",
  });
  await runtime.init();

  const bash = await createTenantBashToolkit({
    tenantId: "demo-user",
    files: WORKSPACE_FILES,
    destination: "/workspace",
  });

  globalThis.__agentKitExample = { afs, runtime, live, bash };
  return {
    runtime,
    model: live.model,
    label: live.label,
    provider: live.provider,
    bashTools: bash.tools as unknown as ToolSet,
    bash,
  };
}
