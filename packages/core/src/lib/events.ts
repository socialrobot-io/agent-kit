/**
 * Optional structured event hook for hosts (logging / metrics).
 * No OpenTelemetry dependency — pass your own sink.
 */

export type AgentKitEvent =
  | { type: "tool.start"; name: string; args?: unknown }
  | { type: "tool.end"; name: string; ok: boolean }
  | { type: "approval.staged"; subsystem: string; summary: string }
  | { type: "threat.blocked"; reason: string }
  | { type: "turn.finish"; textLength: number };

export type AgentKitEventHandler = (event: AgentKitEvent) => void | Promise<void>;

export function emitAgentKitEvent(
  handler: AgentKitEventHandler | undefined,
  event: AgentKitEvent,
): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(event)).catch(() => {
      // Host sinks must not break the agent loop.
    });
  } catch {
    // ignore
  }
}
