import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fallbackRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const turbopackRoot = process.env.ACD_TURBOPACK_ROOT?.trim() || fallbackRoot;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  outputFileTracingRoot: turbopackRoot,
  turbopack: {
    root: turbopackRoot,
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
