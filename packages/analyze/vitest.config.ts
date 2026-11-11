import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The route/job gates parse every app under examples/ with the injected oxc parser; on a
    // 2-core CI runner that exceeds the 5 s default (measured 6-9 s under a full turbo run).
    testTimeout: 20_000,
  },
});
