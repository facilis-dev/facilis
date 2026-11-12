import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A static template: Vite serves the client on port 3000 and there is no Nitro plugin, so the
// showcase never boots a backend. tailwindcss() is the v4 styling layer.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  // The dependency optimizer's cache must NOT live in node_modules: the VM never mirrors
  // node_modules to OPFS, so a project-root path is what gets restored between boots.
  cacheDir: ".vite-cache",
  // The sandbox exposes dev servers through the facilis.home HTTPS reverse proxy, and Vite
  // rejects unknown Host headers (DEV.md section 4). Dev-only vhost allowance.
  server: {
    port: 3000,
    strictPort: true,
    allowedHosts: ["facilis.home", ".facilis.home", "dsh.home"],
  },
});
