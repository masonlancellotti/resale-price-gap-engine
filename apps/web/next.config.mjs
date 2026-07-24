import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// FLIP DESK web (plan §14). The domain packages are TypeScript-source workspace packages that use
// NodeNext ".js" import specifiers, so we (a) transpile every @flip-desk/* package through Next's
// compiler and (b) teach webpack to resolve ".js" specifiers to their ".ts" source.
const FLIP_PACKAGES = [
  "@flip-desk/api", "@flip-desk/runtime", "@flip-desk/store", "@flip-desk/core", "@flip-desk/money",
  "@flip-desk/stats", "@flip-desk/net", "@flip-desk/llm", "@flip-desk/policy", "@flip-desk/pipeline",
  "@flip-desk/underwrite", "@flip-desk/appraise", "@flip-desk/rank", "@flip-desk/identify",
  "@flip-desk/providers", "@flip-desk/engine", "@flip-desk/adapter-ebay",
  "@flip-desk/sim", "@flip-desk/bookkeeper",
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  transpilePackages: FLIP_PACKAGES,
  // better-sqlite3 is a native binding — never bundle it. It is only required at runtime when
  // FLIP_DB_PATH is set (SqliteStore); the default demo never touches it.
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
