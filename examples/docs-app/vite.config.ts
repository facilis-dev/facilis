import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { prerender } from "@facilis.dev/nitro/prerender";

// A static template: Vite serves the client on port 3000 and there is no Nitro plugin, so the
// docs site never boots a backend. tailwindcss() is the v4 styling layer. prerender() is the
// build-time-only framework pass (D-202/D-168): it prerenders the declared public routes and
// hydrates the same React tree; the runtime stays framework-free. The allowlist lists the
// shipped content pages explicitly — the analyzer reads src/app.tsx statically (D-092), so a
// declared route must be a literal entry there. Pages added later are served by the /docs/*
// catch-all without a React edit; declare them here (and in app.tsx) to prerender them too.
// Replace origin with your own.
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    prerender({
      routes: [
        "/",
        "/docs",
        "/docs/getting-started",
        "/docs/guides",
        "/docs/guides/content-pipeline",
        "/docs/guides/navigation",
        "/docs/reference/frontmatter",
      ],
      origin: "https://docs.example.com",
    }),
  ],
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
