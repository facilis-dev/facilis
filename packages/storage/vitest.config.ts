import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Encryption tests are CPU-bound (key derivation over megabytes); the 5 s default flakes
    // when the package suites run in parallel on a 2-core CI runner.
    testTimeout: 20_000,
  },
});
