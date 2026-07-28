//@ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@agent-kit/ai",
    "@agent-kit/core",
    "@agent-kit/curator",
    "@agent-kit/sandbox",
  ],
  serverExternalPackages: ["agentfs-sdk", "just-bash", "bash-tool"],
};

module.exports = nextConfig;
