import { defineConfig } from "nitro";

// Spike (issue #133): a minimal production-shaped Nitro app. `public/` holds the built
// browser bundle (gitignored); the runner generates it before booting the server.
export default defineConfig({
  serverDir: "./server",
  publicAssets: [{ dir: "./public", baseURL: "/" }],
  compatibilityDate: "2026-11-01",
});
