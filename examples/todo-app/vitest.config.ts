import { defineConfig } from "vitest/config";

// src/lib and the server utils are pure helpers, but db/schema.test.ts is not: since the
// migrations were retired (D-193, D-201) it reads the declaration through createDb, which
// boots a PGlite Wasm cluster. The Vite config boots Nitro, which is not what a unit test
// needs, so this config deliberately does not load it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "db/**/*.test.ts", "server/utils/*.test.ts"],
    environment: "node",
    // Same budget as packages/db and packages/auth: the first cold PGlite boot on a 2-vCPU
    // CI runner outran Vitest's 5 s default and failed an unrelated PR (run 44864976492,
    // issue #153). Serial files keep several Wasm boots from competing for the same CPU.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
