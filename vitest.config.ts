import { defineConfig } from "vitest/config";

// Root vitest config. Internal packages export their TypeScript source directly
// (see each package.json "exports"), so vitest/esbuild resolves cross-package
// imports (e.g. `@flip-desk/core`) with no build step.
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/test/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    globals: false,
  },
});
