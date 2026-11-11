import { defineConfig } from "@facilis.dev/core";

// A config that throws while being imported: `defineConfig` validates at module evaluation,
// so an invalid section fails the import before the loader can parse the export itself.
// The loader must surface that reason, not a bare "failed to load" (D-107 diagnostics).
export default defineConfig({
  auth: { defaultRole: "user" },
  // Unknown key on purpose: exercises the schema error path at import time.
  jobs: { concurrency: 2 } as never,
});
