/**
 * Interactive REPL over the same AgentFS volume as the scripted demo.
 * Remembers across runs. Ctrl+C to exit.
 */

import { createInterface } from "node:readline/promises";
import { mkdir } from "node:fs/promises";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { AgentFS } from "agentfs-sdk";
import { AgentSessionRuntime, defineAgent } from "@agent-kit/core";
import { runAgentTurn } from "@agent-kit/ai";
import { MODEL, requireGatewayKey } from "./env.js";
import { adaptAgentFs } from "./fs-adapter.js";
import { examplePackageRoot, seedAgentHome } from "./seed.js";

async function main(): Promise<void> {
  requireGatewayKey();

  const volumeDir = join(examplePackageRoot(), ".agentfs");
  const volumePath = join(volumeDir, "example.db");
  await mkdir(volumeDir, { recursive: true });
  const afs = await AgentFS.open({ path: volumePath });
  const fs = adaptAgentFs(afs.fs);
  await seedAgentHome(fs);

  const definition = defineAgent({
    model: MODEL,
    config: { writeApproval: { memory: true, skills: true } },
  });
  const runtime = new AgentSessionRuntime({
    tenantId: "demo-user",
    fs,
    definition,
    origin: "foreground",
  });
  await runtime.init();

  console.log(`Chatting with ${MODEL}. Your agent remembers across runs. Ctrl+C to exit.`);

  const history: ModelMessage[] = [];
  const rl = createInterface({ input, output });

  const shutdown = async () => {
    rl.close();
    await afs.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });

  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;

      history.push({ role: "user", content: line });
      try {
        const turn = await runAgentTurn(history, { runtime, model: MODEL });
        const reply = turn.text || "(no text)";
        console.log(reply);
        history.push({ role: "assistant", content: reply });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Turn failed: ${msg}`);
        history.pop();
      }
    }
  } finally {
    rl.close();
    await afs.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
