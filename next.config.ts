import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo already has its own agent-instruction system (see `.claude/`, `_bmad/`).
  agentRules: false,
};

export default nextConfig;
