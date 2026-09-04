# `@socialrobot-io/agent-kit-next`

Next.js config helper for agent-kit. Wraps `next.config` so App Router can load
agents from disk without hand-tuning native packages and file tracing.

## Install

```bash
npm i @socialrobot-io/agent-kit-next @socialrobot-io/agent-kit-node ai next
```

## Usage

Put `agents/` next to `app/` (or `src/app`). Then:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withAgentKit } from "@socialrobot-io/agent-kit-next";

const nextConfig: NextConfig = {};

export default withAgentKit(nextConfig);
```

```ts
// app/api/chat/route.ts
import { loadAgent } from "@socialrobot-io/agent-kit-node";

export const runtime = "nodejs";

const chatAgent = await loadAgent("chat");
```

`withAgentKit` is the only place that chooses the agents folder. It sets file
tracing **and** `AGENT_KIT_AGENTS_DIR`, so `loadAgent("chat")` opens the same
directory Next ships.

### Custom agents folder

```ts
export default withAgentKit(nextConfig, { agentsDir: "src/agents" });

// still:
await loadAgent("chat"); // → src/agents/chat
```

### What it sets

| Option | Default |
| ------ | ------- |
| `serverExternalPackages` | `agentfs-sdk`, `just-bash`, `bash-tool` (merged) |
| `outputFileTracingIncludes["/*"]` | `./agents/**/*` (or `./{agentsDir}/**/*`) |
| `env.AGENT_KIT_AGENTS_DIR` | `agents` (or your `agentsDir`) |

Host values are preserved and merged.
