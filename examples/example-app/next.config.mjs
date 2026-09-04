/**
 * Demo still compiles agents into `src/generated/` for portable installs.
 * withAgentKit still wires native packages + optional ./agents tracing.
 */

import { withAgentKit } from "@socialrobot-io/agent-kit-next";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@socialrobot-io/agent-kit-ai",
    "@socialrobot-io/agent-kit-core",
    "@socialrobot-io/agent-kit-curator",
    "@socialrobot-io/agent-kit-sandbox",
    "@socialrobot-io/agent-kit-next",
  ],
};

export default withAgentKit(nextConfig);
