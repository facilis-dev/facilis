# D-163 — Two persisted filters remove the framework's feature surface from the project graph
**Status:** accepted (2026-11-11); superseded by D-179 (2026-11-13)

**Context.** The framework ships its own tables (auth users/sessions, jobs, workflows, files) and
feature routes (login, queue, workflow endpoints), and D-130 deliberately made the framework
tables reach the browser analyzer through the inlined package source. That closed the "missing
tables" gap but made the graph noisy: the project's own schema and routes are outnumbered by
surface the author did not write. Users need to declutter the drawn graph without losing the
integrity view (invalid and unknown facts must stay visible), and the choice has to be team state
like the rest of the graph layout (D-126).

**Decision.**

- **Two filters, off by default.** The graph toolbar gains a system-filters section
  (`projectGraph.systemFilters`) with **System routes** (`hideSystemRoutes`,
  `projectGraph.systemRoutes`) and **Unused system tables** (`hideSystemTables`,
  `projectGraph.systemTables`), each independently persisted and default `false`; the hint is
  `projectGraph.systemHint` and the removed-node count `projectGraph.hiddenNodes`.
- **System routes.** A route is *system* when its `sourceFile` starts with `node_modules/` OR —
  when the wrapper is known (`unknown === false`) — none of its declared `dbTables` names a
  project-declared relation (a non-framework table or any view). A route whose wrapper is
  unknown/invalid is never hidden, even when the filter is on.
- **Unused system tables.** A table is *system* when it carries the framework flag (declared by
  an installed `@facilis.dev` package, source under `node_modules/`, the `sistema` badge) and is not
  the target of a `route-table` or `route-view` edge whose source is a non-system route. A
  framework table the project's own routes use (e.g. `facilis_files` reached from the
  `/api/todos` routes) therefore stays visible.
- **Drawn view.** An enabled filter removes its hidden nodes and every edge touching them; the
  automatic layout is computed from the visible nodes while the saved positions of the remaining
  nodes are kept, and `ProjectGraphStats.hiddenNodes` reports how many nodes are gone.
- **Persistence.** `.facilis/graph/layout.json` (D-126) gains two additive booleans,
  `hideSystemRoutes`/`hideSystemTables`, default `false`; the file version stays 3 and a layout
  written without them reads as show-everything. "Reset layout" keeps these view preferences,
  exactly like `hiddenEdges`. `graph_state`/`graph_arrange` and the AI patch flow are unchanged
  besides the two additive fields.

**Consequences.** No analyzer change: the classification is derived in the IDE from facts that
already exist (`framework`, `sourceFile`, `dbTables`, the two route edges), so the manifest,
OpenAPI and validator are untouched. Old `layout.json` files and older IDE builds keep working —
the fields are additive and the version does not move. The route classification is a documented
heuristic: a project route that touches no DB relation is classified as system, so the filter
defaults off and can simply be left off; it is a declutter option, not an integrity boundary.
Hidden nodes are not deleted: their positions stay in the layout, so re-enabling a filter restores
the arrangement.

**Verification.** Unit tests in `ide/src/facilis` cover the classification and the view model
(both filters on/off, unknown routes always shown, a project-used framework table kept) and the
layout round-trip (fields default `false`, a file without them reads as off, reset keeps them).
`pnpm --filter @facilis.dev/ide typecheck` and `pnpm --filter @facilis.dev/ide test`.
