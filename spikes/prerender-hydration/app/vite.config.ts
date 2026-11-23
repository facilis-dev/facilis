import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import { vitePrerenderPlugin } from "vite-prerender-plugin";
import { spikePrerender } from "./spike-prerender-plugin.ts";
import { PRERENDER_ROUTES } from "./src/lib/routes.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
// The arm is a file, not an env var: the host runner and the in-VM spawn channel
// both set it the same way, and the native config loader reads it synchronously.
const arm = fs.readFileSync(path.join(root, "spike-arm.txt"), "utf8").trim();

// Arm B: keep the pristine built shell for the SPA fallback. The prerender
// plugin (enforce: post) overwrites index.html with the prerendered home page;
// this pre plugin captures the built asset first, so /app falls back to an
// EMPTY shell instead of another route's prerendered content.
function shellCopy(): Plugin {
  return {
    name: "spike-shell-copy",
    apply: "build",
    // post: vite:build-html (normal) emits index.html first; this hook must run
    // before vite-prerender-plugin (also post, later in the array) overwrites it.
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (html && html.type === "asset") {
        // Directory-shaped: the plugin's previewMiddlewareFallback appends
        // "/index.html" to the fallback path, so it must name a directory.
        this.emitFile({ type: "asset", fileName: "shell/index.html", source: html.source });
      }
    },
  };
}

export default defineConfig({
  cacheDir: ".vite-cache",
  // The spike isolates the prerender mechanics from the native-minifier question
  // (esbuild on Vite 7, oxc on Vite 8): minify:false keeps the build pure JS.
  // Whether default minification works in-VM is probed separately and recorded.
  build: {
    minify: false,
    // Arm B bundles the prerender script as a CLIENT input, but it executes in
    // Node: keep node: builtins external instead of Vite's browser-external stub
    // (the browser never loads the prerender chunk).
    ...(arm === "b" ? { rollupOptions: { external: [/^node:/] } } : {}),
  },
  plugins:
    arm === "a"
      ? [
          nitro({
            // Nitro's bare default is serverDir:false — the Facilis wrapper sets
            // "./server" (FACILIS_NITRO_DEFAULTS); standalone nitro() needs it
            // explicitly or no API route is registered at all.
            serverDir: "./server",
            prerender: { routes: [...PRERENDER_ROUTES], crawlLinks: false },
            // The prerenderer rewrites external deps to file:// URLs resolved
            // under node conditions: react-router-dom's node entry is CJS (named
            // ESM imports fail) and cookie's resolved path does not exist. Bundle
            // everything into the prerenderer instead (the main node-server build
            // already inlines its libs the same way).
            noExternals: true,
          }),
        ]
      : arm === "b"
        ? [
            shellCopy(),
            vitePrerenderPlugin({
              renderTarget: "#root",
              prerenderScript: path.resolve(root, "src/prerender.ts"),
              additionalPrerenderRoutes: ["/stats"],
              previewMiddlewareFallback: "/shell",
            }),
          ]
        : [spikePrerender()],
  // Arm A follows the official nitro vite-ssr-react example: the client entry is
  // the TSX module (no index.html input); Nitro's renderer serves the document.
  ...(arm === "a"
    ? { environments: { client: { build: { rollupOptions: { input: "./src/entry-client.tsx" } } } } }
    : {}),
});
