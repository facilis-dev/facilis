// Arm C: a custom in-process prerender pass (the runner-"self" philosophy).
// No Nitro prerender machinery, no worker: after the client build, an SSR bundle
// is built and imported IN THE SAME REALM, routes are rendered with build-time
// public data fetched over localhost HTTP, and HTML + state are written to dist.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";
import { PRERENDER_ROUTES } from "./src/lib/routes.ts";
import { serializeState } from "./src/lib/state.ts";

interface RenderModule {
  renderRoute: (url: string, data: unknown) => { bodyHtml: string; title: string };
}
interface ApiModule {
  createPublicServer: () => import("node:http").Server;
  listen: (server: import("node:http").Server) => Promise<number>;
}

export function spikePrerender(): Plugin {
  let root = "";
  let outDir = "dist";
  let shellHtml = "";
  let done = false;
  return {
    name: "spike-prerender",
    apply: "build",
    // post: capture index.html after vite:build-html (normal) has emitted it.
    enforce: "post",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (html && html.type === "asset") shellHtml = String(html.source);
    },
    async closeBundle() {
      if (done) return;
      done = true;
      const { build } = await import("vite");
      await build({
        root,
        configFile: false,
        logLevel: "warn",
        build: {
          ssr: true,
          outDir: path.join(outDir, "server"),
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            input: { render: "src/render.tsx", "public-api": "src/lib/public-api.ts" },
            output: { entryFileNames: "[name].js" },
          },
        },
      });
      // Dynamic ESM import of the built chunks in-process: one of the in-VM
      // unknowns this spike proves (native ESM loader over the VFS).
      const renderMod = (await import(
        pathToFileURL(path.resolve(root, outDir, "server", "render.js")).href
      )) as RenderModule;
      const apiMod = (await import(
        pathToFileURL(path.resolve(root, outDir, "server", "public-api.js")).href
      )) as ApiModule;
      const server = apiMod.createPublicServer();
      const port = await apiMod.listen(server);
      try {
        for (const route of PRERENDER_ROUTES) {
          let data: unknown = null;
          if (route === "/stats") {
            const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
            // Fail closed: an error response is never written as a page.
            if (!res.ok) throw new Error(`public API returned ${res.status} — refusing to prerender`);
            data = await res.json();
          }
          const { bodyHtml, title } = renderMod.renderRoute(route, data);
          const doc = shellHtml
            .replace("<title>Prerender Spike</title>", `<title>${title}</title>`)
            .replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`)
            .replace(
              "</head>",
              `<script type="application/json" id="prerender-data">${serializeState({ url: route, data })}</script></head>`,
            );
          const file = route === "/" ? "index.html" : route.slice(1) + "/index.html";
          const abs = path.resolve(root, outDir, file);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, doc);
        }
        // The untouched shell stays available for non-allowlisted routes (/app).
        fs.writeFileSync(path.resolve(root, outDir, "shell.html"), shellHtml);
        // Sitemap from the same allowlist (epic rule 8).
        const urls = PRERENDER_ROUTES.map((r) => `  <url><loc>https://spike.example${r}</loc></url>`).join("\n");
        fs.writeFileSync(
          path.resolve(root, outDir, "sitemap.xml"),
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        );
      } finally {
        server.close();
      }
    },
  };
}
