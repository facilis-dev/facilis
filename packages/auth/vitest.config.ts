import { defineConfig } from "vitest/config";

// PGlite is a single embedded instance per file; serial files keep the suite deterministic.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
