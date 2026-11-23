/**
 * Dev/preview serving of prerendered HTML (D-202 §5): a `configureServer` middleware serves
 * the STORED build HTML for GET + Accept: text/html on declared routes (assets swapped for
 * the dev entry, navigation hrefs rewritten to the preview base) and falls through to the
 * SPA shell otherwise. `vite preview` falls back to `shell.html` for non-declared routes.
 * No Service Worker change (the D-132 patch stays untouched).
 *
 * The build stamp lives in `.facilis/` (dev-only state, gitignored, mirrored by the VM —
 * unlike node_modules) and records the client outDir, which Nitro redirects to
 * `.output/public` for full-stack builds.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";

import { rewriteAnchorHrefs, rewriteDevAssets, routeOutputPath } from "./prerender-html.ts";

export interface PrerenderStamp {
  /** Absolute client build outDir holding the per-route HTML + shell.html. */
  readonly outDir: string;
  readonly routes: readonly string[];
  readonly origin: string | null;
  readonly builtAt: number;
}

export function prerenderStampPath(root: string): string {
  return resolve(root, ".facilis/prerender.json");
}

export function writePrerenderStamp(root: string, stamp: PrerenderStamp): void {
  const file = prerenderStampPath(root);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(stamp, null, 2) + "\n");
}

export function readPrerenderStamp(root: string): PrerenderStamp | null {
  const file = prerenderStampPath(root);
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const stamp = parsed as Partial<PrerenderStamp>;
    if (typeof stamp.outDir !== "string" || !Array.isArray(stamp.routes)) return null;
    if (typeof stamp.builtAt !== "number") return null;
    return { outDir: stamp.outDir, routes: stamp.routes, origin: stamp.origin ?? null, builtAt: stamp.builtAt };
  } catch {
    return null;
  }
}

/** True when no prerendered input changed since the build (stale HTML must not hydrate). */
export function isPrerenderFresh(root: string, builtAt: number): boolean {
  const roots = ["src", "locales"].map((dir) => resolve(root, dir));
  const files = ["index.html", "vite.config.ts", "facilis.config.ts"].map((file) => resolve(root, file));
  const pending = [...roots];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined || !existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (statSync(full).mtimeMs > builtAt) return false;
    }
  }
  for (const file of files) {
    if (existsSync(file) && statSync(file).mtimeMs > builtAt) return false;
  }
  return true;
}

function isHtmlNavigation(req: Connect.IncomingMessage): boolean {
  return req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
}

/**
 * The dev middleware: stored prerendered HTML for fresh declared routes, shell otherwise.
 * Registered from `configureServer`, so it runs before Vite's own HTML fallback.
 */
export function prerenderDevMiddleware(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!isHtmlNavigation(req)) return next();
    const stamp = readPrerenderStamp(root);
    if (stamp === null || stamp.routes.length === 0) return next();
    const path = new URL(req.url ?? "/", "http://facilis.local").pathname;
    if (!stamp.routes.includes(path)) return next();
    if (!isPrerenderFresh(root, stamp.builtAt)) return next();
    const file = resolve(stamp.outDir, routeOutputPath(path));
    if (!existsSync(file)) return next();
    let html = rewriteDevAssets(readFileSync(file, "utf8"));
    const prefix = req.headers["x-forwarded-prefix"];
    if (typeof prefix === "string" && prefix.startsWith("/")) {
      html = rewriteAnchorHrefs(html, prefix);
    }
    // The IDE preview badge reads this marker (issue #85); the SW passes response
    // headers through untouched, so no D-132 divergence is needed.
    res.setHeader("x-facilis-render", "prerender");
    res.setHeader("content-type", "text/html;charset=utf-8");
    res.end(html);
  };
}

/**
 * The preview fallback: non-declared HTML routes get `shell.html`, never the prerendered
 * home (Vite's default SPA fallback would serve `index.html` for every unknown path).
 */
export function prerenderPreviewMiddleware(root: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!isHtmlNavigation(req)) return next();
    const stamp = readPrerenderStamp(root);
    if (stamp === null) return next();
    const path = new URL(req.url ?? "/", "http://facilis.local").pathname;
    const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    if (normalized === "/" || stamp.routes.includes(normalized)) return next();
    if (!existsSync(resolve(stamp.outDir, "shell.html"))) return next();
    req.url = "/shell.html";
    return next();
  };
}

/** The serving plugin both entry points mount (dev middleware + preview fallback). */
export function facilisPrerenderServing(getRoot: () => string): Plugin {
  return { name: "facilis:prerender-serving", ...prerenderServingHooks(getRoot) };
}

/** Hook bundle for the plugins that own prerender serving (facilis() and prerender()). */
export function prerenderServingHooks(root: () => string): {
  configureServer: (server: ViteDevServer) => void;
  configurePreviewServer: (server: { middlewares: Connect.Server }) => void;
} {
  return {
    configureServer(server) {
      server.middlewares.use(prerenderDevMiddleware(root()));
    },
    configurePreviewServer(server) {
      server.middlewares.use(prerenderPreviewMiddleware(root()));
    },
  };
}
