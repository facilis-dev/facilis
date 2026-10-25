import { defineConfig } from "vitest/config";

// PGlite keeps state in a single embedded instance; running files serially keeps the
// suite deterministic and avoids several wasm boots competing for the same CPU.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
