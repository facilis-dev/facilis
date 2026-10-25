import { defineConfig } from "nitro";

export default defineConfig({
  // Nitro v3 does not scan directories unless serverDir is set (spec 4.2 note).
  serverDir: "./server",
  experimental: { openAPI: true },
});
