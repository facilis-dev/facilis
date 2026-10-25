import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite spins up a WASM worker; serial files keep teardown deterministic.
    fileParallelism: false,
  },
});
