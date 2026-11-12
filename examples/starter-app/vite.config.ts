import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { facilis } from "@facilis.dev/nitro/vite";

// One dev server: Vite serves the client and facilis() mounts Nitro on the same
// origin (spec 10.6). Nitro's options are read from facilis.config.ts, so this file
// never names Nitro itself. tailwindcss() is the v2 styling layer.
export default defineConfig({
  plugins: [tailwindcss(), facilis(), react()],
  // The dependency optimizer's cache must NOT live in node_modules: the VM never mirrors
  // node_modules to OPFS (it is restored from the lockfile-keyed dep cache), so the default
  // node_modules/.vite is discarded on every boot and rolldown re-bundles every dependency
  // each time — measured as seconds of wasm CPU per boot. A project-root path is mirrored.
  cacheDir: ".vite-cache",
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
