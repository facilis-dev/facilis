/**
 * Document assembly and output naming for the prerender pass (D-202 §5/§6): subfolder-index
 * per-route HTML, the always-emitted `shell.html`, canonical + sitemap only when an origin
 * is declared, and the dev/preview serving rewrites (preview-base hrefs, dev entry assets).
 */

import { islandScriptTag, type PrerenderIsland } from "./prerender-island.ts";

export interface PrerenderDocumentInput {
  /** The emitted SPA shell (captured from the client bundle's index.html asset). */
  readonly shell: string;
  /** Hoisted React 19 document metadata for the route (may be empty). */
  readonly head: string;
  /** Rendered page markup. */
  readonly body: string;
  /** Public responses keyed by request path (empty object for a static page). */
  readonly island: PrerenderIsland;
  /** Validated absolute origin; canonical is emitted only when present. */
  readonly origin?: string;
  /** The declared route path, verbatim. */
  readonly route: string;
}

/** Inject markup + hoisted head + island into the shell; never rewrite the shell's scripts. */
export function assemblePrerenderDocument(input: PrerenderDocumentInput): string {
  const rootPattern = /<div id="root">\s*<\/div>/;
  if (!rootPattern.test(input.shell)) {
    throw new Error('[facilis] prerender: the shell has no empty <div id="root"></div> to fill');
  }
  let shell = input.shell.replace(rootPattern, `<div id="root">${input.body}</div>`);
  let head = input.head;
  if (/<title[\s>]/.test(head)) {
    // The route's hoisted title replaces the shell's, never duplicates it.
    shell = shell.replace(/<title>[\s\S]*?<\/title>/, "");
  }
  if (input.origin !== undefined) head += canonicalTag(input.origin, input.route);
  head += islandScriptTag(input.island);
  return shell.replace("</head>", `${head}</head>`);
}

/** Subfolder-index output path: "/" -> index.html, "/about" -> about/index.html. */
export function routeOutputPath(route: string): string {
  return route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
}

/** Canonical paths are the declared paths verbatim (no trailing slash added, D-202 §5). */
export function canonicalTag(origin: string, route: string): string {
  return `<link rel="canonical" href="${origin}${route === "/" ? "/" : route}"/>`;
}

/** sitemap.xml lists exactly the allowlist (D-202 §6); emitted only with an origin. */
export function sitemapXml(origin: string, routes: readonly string[]): string {
  const urls = routes
    .map((route) => `  <url><loc>${origin}${route === "/" ? "/" : route}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Rewrite root-relative navigation hrefs to the serving base (D-202 §5, spike gotcha 7):
 * under the IDE preview prefix the client router keeps `basename=/preview/<port>`, so a
 * server href that stays root-relative can never match the hydrated client href (React
 * #418). Protocol-relative and absolute hrefs are left alone.
 */
export function rewriteAnchorHrefs(html: string, base: string): string {
  return html.replace(/<a\b([^>]*?)href="\/(?!\/)([^"]*)"/g, `<a$1href="${base}/$2"`);
}

/**
 * Swap built asset tags for the dev entry when serving stored HTML from `vite dev`: the
 * hashed bundles do not exist in dev, while the markup + island still hydrate against the
 * dev-transformed modules. Root-relative dev URLs stay root-relative — the preview Service
 * Worker routes them by frame (no sw.js change, D-132).
 */
export function rewriteDevAssets(html: string): string {
  let out = html.replace(/<script\b[^>]*src="\/assets\/[^"]*"[^>]*>\s*<\/script>/g, "");
  out = out.replace(/<link\b[^>]*href="\/assets\/[^"]*"[^>]*>/g, "");
  out = out.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
  return out.replace(
    "</head>",
    '<script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script></head>',
  );
}
