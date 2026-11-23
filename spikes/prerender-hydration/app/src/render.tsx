import { renderToString } from "react-dom/server";
// react-router-dom 7.18 exports StaticRouter from the main entry (the old
// "./server" subpath is gone); one package for client and server routers.
import { StaticRouter } from "react-router-dom";
import { AppRoutes } from "./app.tsx";
import { PrerenderDataContext } from "./lib/data-context.ts";
import { DEFAULT_TITLE, ROUTE_TITLES } from "./lib/routes.ts";
import { serializeState, type PrerenderState } from "./lib/state.ts";

// The shared renderer: identical React tree for every arm (epic rule 7).
// Data is pre-fetched by the caller, so renderToString is deterministic and
// synchronous — no Suspense boundary can leak a loading state into the HTML.
export function renderRoute(url: string, data: unknown): { bodyHtml: string; title: string } {
  const bodyHtml = renderToString(
    <PrerenderDataContext.Provider value={{ url, data }}>
      <StaticRouter location={url}>
        <AppRoutes />
      </StaticRouter>
    </PrerenderDataContext.Provider>,
  );
  return { bodyHtml, title: ROUTE_TITLES[url] ?? DEFAULT_TITLE };
}

export interface AssetTags {
  entry: string;
  css: { href: string }[];
  js: { href: string }[];
}

function headTags(assets: AssetTags): string {
  const css = assets.css.map((a) => `<link rel="stylesheet" href="${a.href}" />`).join("");
  const preload = assets.js.map((a) => `<link rel="modulepreload" href="${a.href}" />`).join("");
  return css + preload;
}

// Full prerendered document (arm A): content + per-route title + state island.
export function fullDocument(opts: { bodyHtml: string; title: string; state: PrerenderState; assets: AssetTags }): string {
  const { bodyHtml, title, state, assets } = opts;
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>${title}</title>${headTags(assets)}` +
    `<script type="application/json" id="prerender-data">${serializeState(state)}</script></head>` +
    `<body><div id="root">${bodyHtml}</div>` +
    `<script type="module" src="${assets.entry}"></script></body></html>`
  );
}

// The SPA shell (non-allowlisted routes): empty root, client entry creates the root.
export function shellDocument(assets: AssetTags): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>${DEFAULT_TITLE}</title>${headTags(assets)}</head>` +
    `<body><div id="root"></div>` +
    `<script type="module" src="${assets.entry}"></script></body></html>`
  );
}
