// Arm B: the vite-prerender-plugin script. Node-only, runs in the build process
// (the plugin imports the built chunk in-process — no worker, no DOM).
import { ROUTE_TITLES, DEFAULT_TITLE } from "./lib/routes.ts";
import { createPublicServer, listen } from "./lib/public-api.ts";
import { renderRoute } from "./render.tsx";

export async function prerender(input: { url: string }): Promise<{
  html: string;
  data: { url: string; data: unknown };
  head: { title: string };
  links: Set<string>;
}> {
  const url = input.url === "/stats" ? "/stats" : "/";
  let data: unknown = null;
  if (url === "/stats") {
    // Real localhost HTTP fetch at build time (absolute URL: the plugin's
    // fs-based fetch patch only intercepts root-relative URLs).
    const server = createPublicServer();
    const port = await listen(server);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
      if (!res.ok) throw new Error(`public API returned ${res.status} — refusing to prerender an error body`);
      data = await res.json();
    } finally {
      server.close();
    }
  }
  const { bodyHtml } = renderRoute(url, data);
  return {
    html: bodyHtml,
    data: { url, data },
    head: { title: ROUTE_TITLES[url] ?? DEFAULT_TITLE },
    // Empty: the allowlist is authoritative, no link crawling (epic rule 1).
    links: new Set<string>(),
  };
}
