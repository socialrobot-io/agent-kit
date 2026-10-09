/**
 * Two kits on one Postgres: the web kit answers chats and queues a review
 * after each turn; the worker kit runs those reviews. In an app they live in
 * different processes (a web server and a queue worker) and only the
 * database and the queue connect them.
 */

import type { LanguageModel } from "ai";
import {
  createAgentKit,
  type AgentBundle,
  type AgentKit,
  type CuratorQueue,
} from "@socialrobot-io/agent-kit-node";
import { postgresStorage, type SqlClient } from "@socialrobot-io/agent-kit-node/postgres";

export interface DemoKitsOptions {
  db: SqlClient;
  agent: AgentBundle;
  /** Model for chat turns. */
  chatModel: LanguageModel;
  /** Model for curator reviews (often a cheaper one). */
  curatorModel: LanguageModel;
  /** Where the web kit sends review jobs. */
  queue: CuratorQueue;
}

export interface DemoKits {
  web: AgentKit;
  worker: AgentKit;
}

export function createDemoKits(opts: DemoKitsOptions): DemoKits {
  // One adapter is enough: every tenant shares the tables, keyed by tenant_id.
  const storage = postgresStorage({ db: opts.db });
  // No bash sandbox: hosts on database storage usually skip it, and then
  // AgentFS's native binding is never loaded.
  const shared = { agent: opts.agent, storage, sandbox: false } as const;

  return {
    web: createAgentKit({ ...shared, model: opts.chatModel, curatorQueue: opts.queue }),
    worker: createAgentKit({ ...shared, model: opts.curatorModel }),
  };
}
