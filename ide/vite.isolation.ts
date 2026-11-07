import type { Plugin } from "vite";

// Grant the preview Service Worker (served at /sw.js) a root scope so it can intercept
// /preview/<port>/... for the whole origin. The isolation headers it stamps are passed in
// because the dev server and the preview server also need them (vite.config.ts).
export function swScope(isolation: Record<string, string>): Plugin {
  const mw = (req: any, res: any, next: any) => {
    for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v);
    if (req.url && req.url.split("?")[0].endsWith("/sw.js"))
      res.setHeader("Service-Worker-Allowed", "/");
    next();
  };
  return {
    name: "vv-cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}
