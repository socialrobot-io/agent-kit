export {
  createTenantHome,
  resetTenantHomeCache,
  type CreateTenantHomeOptions,
  type HomeStores,
  type OpenHomeSessionOptions,
  type RecordTurnInput,
  type RecordTurnResult,
  type TenantHome,
  type TurnMessage,
} from "./lib/tenant-home.js";
export {
  agentFsStorage,
  defaultVolumePath,
  openTenantVolume,
  type AgentFsStorageOptions,
  type StorageAdapter,
  type StorageVolume,
  type TenantStorage,
} from "./lib/storage.js";
export {
  compileAgent,
  loadAgent,
  resolveAgentPath,
  resolveAgentsDir,
  AGENT_KIT_AGENTS_DIR_ENV,
  DEFAULT_AGENTS_DIR,
  type CompileAgentOptions,
} from "./lib/compile-agent.js";
export {
  createAgentKit,
  type AgentKit,
  type CreateAgentKitOptions,
  type KitSessionOptions,
} from "./lib/agent-kit.js";
export {
  attachSessionCurator,
  waitForSessionCurators,
  resolveCuratorConfig,
  parseCuratorJob,
  type AttachSessionCuratorOptions,
  type CuratorJob,
  type CuratorMode,
  type CuratorQueue,
} from "./lib/session-curator.js";

/** Re-export the pieces hosts usually need so one import covers the happy path. */
export {
  defineAgent,
  createAgentFs,
  installAgent,
  PathPolicyError,
  MEMORY_SCHEMA,
  SKILLS_LIST_SCHEMA,
  SKILL_VIEW_SCHEMA,
  SKILL_MANAGE_SCHEMA,
  type AgentBundle,
} from "@socialrobot-io/agent-kit-core";
export { SESSION_SEARCH_TOOL_SCHEMA } from "@socialrobot-io/agent-kit-sessions";
export { openAgentSession, type AgentSession } from "@socialrobot-io/agent-kit-ai";
// Type only: the sandbox package loads lazily (see openTenantVolume in storage.ts).
export type { TenantVolume } from "@socialrobot-io/agent-kit-sandbox";
export type { CuratorOutcome } from "@socialrobot-io/agent-kit-curator";
