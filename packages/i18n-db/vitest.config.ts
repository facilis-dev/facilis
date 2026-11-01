import { defineConfig } from "vitest/config";

// PGlite uses one embedded wasm database per test file; serial files keep the suite
// deterministic and avoid several wasm boots competing for the same CPU.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
