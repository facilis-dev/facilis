import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { facilis } from "@facilis/nitro/vite";
import { tailwindRescanInVm } from "./vite-plugins/tailwind-rescan.ts";

// One dev server: Vite serves the client and facilis() mounts Nitro on the same
// origin (spec 10.6). Nitro's options are read from facilis.config.ts, so this file
// never names Nitro itself.
//
// tailwindcss() is the v2 styling layer. tailwindRescanInVm() is the WebContainer-only
// workaround for tailwindlabs/tailwindcss#20605 (see vite-plugins/tailwind-rescan.ts): it is
// a no-op on the host and during a build.
export default defineConfig({
  plugins: [tailwindcss(), tailwindRescanInVm(), facilis(), react()],
  // "~" is the project root: server routes import "~/facilis.config" and "~/db/schema".
  // src/ code uses relative imports (they carry explicit .ts/.tsx extensions).
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
