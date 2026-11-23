// Arm A: the Nitro-auto-detected SSR entry (official vite-ssr-react pattern).
import clientAssets from "./entry-client?assets=client";
import serverAssets from "./entry-server?assets=ssr";
import { publicStats } from "./lib/public-api.ts";
import { PRERENDER_ROUTES } from "./lib/routes.ts";
import { initI18n, initTheme } from "./lib/state.ts";
import { fullDocument, renderRoute, shellDocument } from "./render.tsx";

const assets = clientAssets.merge(serverAssets);
const HTML_HEADERS = { "content-type": "text/html;charset=utf-8" };

export default {
  async fetch(req: Request): Promise<Response> {
    initTheme();
    initI18n();
    const url = new URL(req.url);
    const route = url.pathname;
    // Only allowlisted routes render content; everything else (incl. /app)
    // stays the SPA shell. No session, no system identity (epic rule 3).
    if (!(PRERENDER_ROUTES as readonly string[]).includes(route)) {
      return new Response(shellDocument(assets), { headers: HTML_HEADERS });
    }
    let data: unknown = null;
    if (route === "/stats") {
      // Direct same-realm import, NOT a self-fetch: the prerender request URL
      // carries no usable port (h3 builds it from the route path), so a loopback
      // self-fetch is ambiguous inside the prerender worker. The public data
      // function is the same one the /api/stats route serves (permission:
      // []-style, no identity). Note: with serverDir unset, Nitro registers NO
      // API routes at all — neither in the app nor in the prerenderer.
      try {
        data = publicStats();
      } catch {
        // Fail closed: a data error is never written as a page.
        return new Response(shellDocument(assets), { headers: HTML_HEADERS });
      }
    }
    const { bodyHtml, title } = renderRoute(route, data);
    return new Response(fullDocument({ bodyHtml, title, state: { url: route, data }, assets }), {
      headers: HTML_HEADERS,
    });
  },
};
