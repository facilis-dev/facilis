# D-085 — The API Flow reads the AST-augmented OpenAPI document and renders it with React Flow
**Status:** superseded by D-095 (2026-11-06); kept as history
**Originally:** accepted (2026-11-02)

SPEC §10.2 and §12 Phase 3 ask for an API visualizer: the project's API as a graph, with
click-to-jump into the route source. The facade built in Phase 0/1 already publishes what the
graph needs — `/_openapi.json` merges the AST pass's `x-permission`, `x-db-tables`,
`x-db-columns` and `x-facilis-source` onto Nitro's native document (SPEC §6.9) — but nothing
rendered it. The Entity Explorer (D-083) established the read pattern: a dev-only endpoint
reached through the preview proxy, narrowed at the client boundary, shown in a new sidebar.

**Decision.** A new `api` activity view backed by React Flow, without a new backend surface.

- **Transport.** The panel fetches `GET <preview-proxy-base>/_openapi.json` with the same
  throw-free client shape as the manifest and schema clients, refreshes on the 60-byte revision
  poll and on demand, and renders "unreachable" instead of taking the editor down. The facade is
  dev-only (404 in production), which is the same availability the other panels have.
- **Model.** A pure module turns the operations into a deterministic layered graph: one node per
  operation grouped by resource (the first path segment), one node per table, an edge
  operation→table from `x-db-tables` (and from `x-db-columns` prefixes for routes that only name
  columns). Layout is computed, not random, so the graph is stable across refreshes and testable
  without a DOM.
- **Interaction.** Clicking an operation node opens `x-facilis-source`; clicking a table node
  opens `db/schema.ts`. Method and permission badges are read from the operation; a route whose
  metadata the AST pass could not resolve simply shows fewer badges (the facade omits the field,
  it never guesses).
- **React Flow is the dependency SPEC §10.2 names** (`@xyflow/react` 12.12.1, 19 packages in the
  lockfile). The node components are ours and use only semantic Tailwind role tokens, so theme
  blocks flip them (D-043/D-044).

**Rejected alternatives.** A hand-rolled SVG layout: more code, no pan/zoom/fit, and it would
replace a dependency the spec already committed to. Fetching the manifest instead of the OpenAPI
document: the manifest's route list has no operation summaries or permission metadata from Nitro,
and the visualizer is specifically the API contract. A new editor tab kind: the tab strip is
typed for file kinds (`text`/`image`/`directory`/`diff`/`notebook`), and every Facilis visualizer
now lives in the activity bar (D-083 precedent) where it can be resized.

**Consequences.** New dependency in the IDE bundle (React Flow is lazy-loaded by the view only when
opened, like the other panel chunks). Routes without `x-facilis-source` are listed but not
clickable; routes whose metadata the AST pass marked unresolved show no permission/table badges.
Strings are in `en`/`it`; the panel has unit tests for parse, model and transport, and the browser
smoke opens it and waits for nodes.

**Verification.** 19 IDE tests (parse 6, model 7, transport 6) cover the `/_openapi.json`
narrowing, the deterministic graph model and the throw-free fetch; the IDE's i18n parity suite
includes the new block. `pnpm lint`, `pnpm typecheck` and `pnpm build` are green, and
`pnpm ide:smoke` on a fresh profile opens the `api` activity view, waits for route and table
nodes, clicks a route node and reaches its source file.

**Amended by D-087:** the panel is an editor-area tab, not a sidebar activity view, and it also
shows the client pages that call each route.
