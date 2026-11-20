# D-134 — The project graph shows real pages, explicit page links and audited elevation
**Status:** accepted (2026-11-10)

The graph was an API-first view: page nodes existed only for client files that called a route,
so a real page like `not-found.tsx` disappeared, while a lib file that called an API could look
like a page. The route card also hid the one fact a reviewer needs before trusting a
`route → table` edge: whether the table is reached through the audited `ctx.sudo`/`ctx.system`
elevation (D-099). Pages had no structure and no navigation edges, so the page column stayed a
list of filenames.

**Decision.** Keep one graph and one AST fact model; add the missing facts additively.

- **Pages only.** A graph page node is a `src/pages/**` file (`PageFact.kind === "page"`) and is
  shown even when it calls no API. Component/lib consumers stay analyzer facts; they are not
  graph nodes. The page card shows the URL paths resolved from the explicit route table and an
  `unrouted` badge when the page is absent from it.
- **Elevation edges.** The route handler pass reads destructured `{ sudo }`/`{ system }` and
  `ctx.sudo`/`ctx.system` calls, plus their static `tables` array (literal, same-file const or
  one-hop import). A table in that set marks the existing route-table edge with
  `access: "elevated"`; the graph uses one warning colour for both APIs, a route-card chip and a
  legend entry, never a second duplicate edge. A dynamic `tables` list is recorded as unknown
  rather than guessed.
- **Static page preview.** A `screens` pass reads the explicit `src/app.tsx` route table and the
  page/layout/app JSX, resolves components through the module graph, splices child routes into
  `<Outlet>`, and emits bounded flat preview nodes (depth 4, 60 nodes, cycles cut, dynamic
  branches marked, UI primitives kept as leaves). The page inspector renders that structure as
  nested boxes that jump to source; it is explicitly a structure view, not a rendering.
- **Explicit page links.** Only `Link`/`NavLink` `to` and `useNavigate()` calls with a static path
  become `page-link` edges; guards, `<Navigate>` redirects and shared providers are out of scope.
  Targets resolve through the route table, so a link to a page that is not routed stays unknown.

**Consequences:** the graph gains `page-link` as a fifth kind (filters, legend, persistence and
AI tools pick it up from `GRAPH_EDGE_KINDS`); old `.facilis/graph/` files remain valid because
unknown hidden-edge names are ignored. `@facilis.dev/analyze` gains route `elevations`, page
`routePaths`/`preview` and internal screen facts; the Nitro metadata/OpenAPI contract is
unchanged. The preview is capped and static by design: conditions, data and CSS are never
executed.

**Verification:** analyzer unit tests cover `ctx.sudo`/`ctx.system` extraction (including the
unknown-tables path), page previews through `Outlet`, route-table path resolution, all pages and
page links; IDE graph-model/style tests cover the new data, stats and the single elevated style;
the framework analysis regression is updated to the new node/edge counts. Root
`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` are the gate.
