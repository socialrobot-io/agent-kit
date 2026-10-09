/**
 * Stand-in for your job queue (BullMQ, SQS, a jobs table). Jobs cross it as
 * JSON strings, like they would cross Redis or a network, so the worker side
 * shows the real contract: parse, validate, run.
 */

import type { CuratorJob } from "@socialrobot-io/agent-kit-node";

export class JsonQueue {
  private readonly jobs: string[] = [];

  /** What the web kit's `curatorQueue` calls after each turn. */
  readonly push = (job: CuratorJob): void => {
    this.jobs.push(JSON.stringify(job));
  };

  /** Next job as the worker receives it: raw JSON, not yet trusted. */
  take(): string | undefined {
    return this.jobs.shift();
  }

  get size(): number {
    return this.jobs.length;
  }
}
