// The single route table's metadata (D-058): the allowlist and per-route titles.
// Pure TS so the build config, the renderer and the client all import one source.
export const PRERENDER_ROUTES = ["/", "/stats"] as const;

export const ROUTE_TITLES: Readonly<Record<string, string>> = {
  "/": "Home — Prerender Spike",
  "/stats": "Stats — Prerender Spike",
};

export const DEFAULT_TITLE = "Prerender Spike";
