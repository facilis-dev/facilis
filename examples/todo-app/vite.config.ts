import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { facilis } from "@facilis/nitro/vite";

// One dev server: Vite serves the client and facilis() mounts Nitro on the same
// origin (spec 10.6). Nitro's options are read from facilis.config.ts, so this file
// never names Nitro itself.
export default defineConfig({
  plugins: [facilis(), react()],
  resolve: {
    alias: { "~": new URL(".", import.meta.url).pathname },
  },
  // The sandbox exposes dev servers through the facilis.home HTTPS reverse proxy, and Vite 8
  // rejects unknown Host headers (DEV.md section 4). Dev-only vhost allowance; a normal deploy
  // never uses it.
  server: {
    allowedHosts: ["facilis.home", ".facilis.home", "dsh.home"],
  },
});
