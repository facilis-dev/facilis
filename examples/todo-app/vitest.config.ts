import { defineConfig } from "vitest/config";

// Only pure helpers are unit-tested: src/lib and db (hand-written DDL), plus the server
// utils that hold no I/O. The Vite config boots Nitro, which is not what a unit test needs,
// so this config deliberately does not load it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "db/**/*.test.ts", "server/utils/*.test.ts"],
    environment: "node",
  },
});
