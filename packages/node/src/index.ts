export {
  createTenantHome,
  resetTenantHomeCache,
  type CreateTenantHomeOptions,
  type OpenHomeSessionOptions,
  type TenantHome,
} from "./lib/tenant-home.js";
export { compileAgent, loadAgent, type CompileAgentOptions } from "./lib/compile-agent.js";
export {
  attachSessionCurator,
  waitForSessionCurators,
  resolveCuratorConfig,
  type AttachSessionCuratorOptions,
  type CuratorMode,
} from "./lib/session-curator.js";

/** Re-export the pieces hosts usually need so one import covers the happy path. */
export {
  defineAgent,
  createAgentFs,
  installAgent,
  PathPolicyError,
  type AgentBundle,
} from "@socialrobot-io/agent-kit-core";
export { openAgentSession, type AgentSession } from "@socialrobot-io/agent-kit-ai";
export { openTenantVolume, type TenantVolume } from "@socialrobot-io/agent-kit-sandbox";
