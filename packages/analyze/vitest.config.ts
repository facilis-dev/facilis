import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // The route/job/i18n/import-cycle gates parse every app under examples/ with the injected oxc
    // parser; on a 2-core CI runner that no longer fits the old 20 s ceiling (measured 18-22 s
    // under a full turbo run, and each gate runs beside the others).
    testTimeout: 60_000,
  },
});
