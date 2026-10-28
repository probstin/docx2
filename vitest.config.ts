import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve workspace packages to their TypeScript sources (see package "exports").
    conditions: ["development"],
  },
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.{ts,tsx}",
      "tools/*/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
