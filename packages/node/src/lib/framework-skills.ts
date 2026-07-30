/**
 * Kit-owned skills installed on every tenant home. Always locked.
 * Hosts never configure this path — the framework injects it.
 */

import type { SkillSeed } from "@socialrobot-io/agent-kit-core";

/** Framework skill pack. Empty until the kit ships builtins. */
export const FRAMEWORK_SKILLS: readonly SkillSeed[] = [];
