import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // PGlite suites (jobs store, executor, dev persistence) boot Wasm instances concurrently;
    // the default 5 s is too tight for the snapshot round-trip under a full turbo run.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
