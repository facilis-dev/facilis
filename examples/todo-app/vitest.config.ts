import { defineConfig } from "vitest/config";

// Only the pure helpers in src/lib are unit-tested: the Vite config boots Nitro, which is
// not what a unit test needs, so this config deliberately does not load it.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
