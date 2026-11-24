import { defineConfig } from "vitest/config";

// The tests cover pure helpers and the catalogues, so they run in Node without a DOM or the
// Vite plugin chain. The dev server config is deliberately not loaded here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
