//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@socialrobot-io/agent-kit-ai",
    "@socialrobot-io/agent-kit-core",
    "@socialrobot-io/agent-kit-curator",
    "@socialrobot-io/agent-kit-sandbox",
  ],
  serverExternalPackages: ["agentfs-sdk", "just-bash", "bash-tool"],
};

module.exports = nextConfig;
