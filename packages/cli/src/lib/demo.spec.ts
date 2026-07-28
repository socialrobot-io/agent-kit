import { describe, it, expect } from "vitest";
import { runDemo } from "./demo.js";

describe("agent-kit demo (self-improvement flywheel)", () => {
  it("distills memory + skill, recalls on session 2, isolates tenants", async () => {
    const lines: string[] = [];
    const ok = await runDemo((s) => lines.push(s));
    expect(ok).toBe(true);
    // Spot-check the narrative ran end-to-end.
    expect(lines.join("\n")).toContain("DEMO PASSED");
  });
});
