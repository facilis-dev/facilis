# Facilis AST DSL — contract v0 (draft)

Status: **accepted and implemented, 2026-11-04** (D-092, D-093). The analyzer is the source of
project facts for the IDE graph, the AI validator and the Nitro manifest/OpenAPI pass.
Direction agreed in review: the analyzer **interprets the framework's declarative DSL itself**,
with **zero build-time execution**. Runtime endpoints remain only for genuinely live state
(applied catalog, drift, boot); they are not a source for the facts described here.

**Decisions taken in review (2026-11-04):**

- `dbColumns` uses **Drizzle property names** (`todos.dueDate`); the SQL name is derived from
  the column builder and exposed for display and SQL-facing comparisons.
- Table links: **both** `.references(...)` (physical foreign key) and Drizzle `relations(...)`
  (logical relation) are interpreted, as **distinct edge kinds**.
- Framework tables: parse the installed `@facilis.dev/*` source (the packages ship `src/`); a
  bundled fact provider is only a fallback, not the primary source.
- The graph is **one full-screen graph**, with edge-kind filters, draggable nodes and layout
  persistence to a project file (§7).
- Client calls: **one sanctioned transport, everything else blocked**. `api()` in
  `src/lib/api.ts` is the transport (the preview base path makes bare relative `fetch` unsafe);
  the gate blocks every other network call in `src/**`. The contract keeps the transport
  configurable by module + export, so a native-`fetch` variant is a config change later.
- Layout persistence: `.facilis/graph/` — **committed team state** (D-126): `layout.json`
  (settings), `positions/<key>.json` (one position per node or note), `bends/<key>.json` (one
  bend per edge), `notes/<uuid>.md` (markdown annotations); `viewport.json` stays local
  (git-ignored).

## 1. Goal and non-goals

Goal: from a plain map of project source files, produce one fact model that lets the Studio
answer, without a dev server:

1. **Schema**: which tables exist, their columns (name, type, nullability, PK, unique, default,
   scope), their RLS policies, and both physical (foreign-key) and logical (`relations()`) links between tables.
2. **API**: which routes exist (method, path, permission, declared tables/columns), which are
   well-formed, and which are not.
3. **Pages**: which client files reach which route, directly or through one import hop.
4. **Validation**: force the constructs that make the above analyzable (notably
   `defineAuthorizedHandler` for every route) and report violations without omitting nodes.

The same facts feed the IDE panels, the AI validator and a CI gate. Non-goals for v0: live
database state, applied migrations, arbitrary JS evaluation, Zod → JSON Schema, exact
Postgres-rendered policy SQL.

## 2. Fact model (conceptual)

Every fact carries `source` (file, line) and an explicit `unknown` channel. A fact that cannot
be determined is **not** omitted and is **not** defaulted to empty.

```
TableFact        name, binding, columns[], primaryKey[], foreignKeys[], policies[],
                 rlsEnabled, scope?, source, unknown[]
ColumnFact       property, name, builder, type, notNull, primaryKey, unique,
                 default?, references?, source, unknown[]
ForeignKeyFact   from {table, column}, to {table, column}, onDelete?, onUpdate?
RelationFact     from table, to table, cardinality (one|many), fields?, references?
PolicyFact       name, command, restrictive, source, unknown[]
RouteFact        method, path, sourceFile, wrapper (valid|invalid|unknown),
                 permission?, dbTables?, dbColumns?, description?,
                 elevations[], input {body, query, params}, diagnostics[], unknown[]
PageFact         path, kind (page|component|lib), calls[], unknown[]
PagePreview      routePaths[], JSX nodes[] (component|intrinsic|slot), truncated
PageLink         from page, to page, toPath, kind (link|navlink|navigate), source
RouteCall        routeId?, pathExpression, expressionKind (literal|concat|template|
                 builder|dynamic), source, unknown
Diagnostic       code, severity (error|warning|info), file, line, message, related?
```

`ScopeFact.column` is the **Drizzle property key** (matching the `dbColumns` domain); the
SQL name stays on the corresponding `ColumnFact.name`.

Three-state rule: `dbTables` is either a value, `undefined + unknown`, or an explicit empty
array. "Unknown" must never render as "no tables".

## 3. DSL surface to force

The analyzer is only as strong as this surface. Everything else is `unknown`.

### 3.1 Server routes — mandatory

| Construct | Requirement | What the interpreter reads |
|---|---|---|
| `export default defineAuthorizedHandler(config, handler)` | every file under `server/routes/**` (and `server/api/**`, if enabled) | callee resolved to `@facilis.dev/core`; config object; handler body only for input reads |
| wrapper forms | direct, `const h = ...; export default h`, `as const`/`satisfies`/parens, config via same-file const or one-hop project import | same fact, no omission |
| `permission` | required; string or string[]; declared in `config.auth.permissions` | literal/const |
| `dbTables` | required; `string[]` (`[]` = explicit "no DB") | literal/const/import |
| `dbColumns` | optional; `"table.column"` — **Drizzle property keys** (decided); SQL name derived from the column builder | literal/const/import |
| `description` | optional, one English sentence ≤120 chars (D-129); shown under the route node and in OpenAPI | literal/const |
| `body`/`query`/`params` | presence required if the handler reads that input | property presence; Zod shape is v1 |
| raw handler | **error**: the route is still listed (from filename) with `wrapper: invalid` | — |

### 3.2 Config — mandatory

| Construct | Requirement | What the interpreter reads |
|---|---|---|
| `export default defineConfig({...})` in `facilis.config.ts` | mandatory | callee resolved to `@facilis.dev/core`; object literal |
| static subset | object/array/string/number/boolean/literal, same-file const, one-hop project import | resolved value |
| defaults | `tenantColumns`, `ownerColumns`, `migrationsDir`, `i18n`, ... | applied from the same constants/schema as `@facilis.dev/core` |
| computed values | `process.env`, function calls, conditionals | `unknown` + diagnostic; gate decides error/warning |

### 3.3 Schema — mandatory DSL

| Construct | Requirement | What the interpreter reads |
|---|---|---|
| `pgTable(name, columns, extras?)` from `drizzle-orm/pg-core` | whitelisted call; name is a literal/const string | table name |
| `columns` | object literal; spread/computed keys `unknown` (or resolve spread of a local object literal) | column entries |
| column builders | `uuid, text, varchar, boolean, timestamp, date, integer, bigint, numeric, jsonb, json, serial, bigserial, real, doublePrecision, pgEnum`; `tenantColumn` from `@facilis.dev/db` | SQL name (first string arg or property key), display type (builder + args), scope |
| column methods | `.notNull()`, `.primaryKey()`, `.unique()`, `.default(value)`, `.defaultRandom()`, `.defaultNow()`, `.references(() => table.column, opts)`, `.array()` | flags, default, FK |
| policy helpers in the extras callback | `tenantIsolationPolicy`, `ownerIsolationPolicy`, `rolePolicy`, `rlsForTable`/`withRls`, `pgPolicy("name", opts)` | name, command, restrictive/permissive; SQL not rendered in v0 |
| RLS | `.enableRLS()` on the table chain; required for scoped tables | boolean + diagnostic |
| `relations(table, ({ one, many }) => ({...}))` | optional; may live in `db/schema.ts` or a separate `db/relations.ts`; `one(target, { fields, references })` and `many(target)` | logical `RelationFact`: target table, cardinality, optional column mapping — a **different edge kind** from FK |
| re-exports | `export { users, ... } from "@facilis.dev/auth"` | parse the installed framework package source (it ships `src/`); `unknown` + diagnostic if not found (bundled provider only as fallback) |
| custom builders/wrappers | anything not in the whitelist | `unknown` + diagnostic, table/column still listed with partial facts if the name is known |

### 3.4 Pages / client consumers — one sanctioned transport

Decision: exactly **one client transport** for internal API calls, and everything else in
`src/**` is blocked by the gate. Recommended transport: the existing
`api<T>(path, init)` helper in `src/lib/api.ts`.

Why `api()` and not bare `fetch`:

- the IDE preview serves the app under `/preview/<port>/`; an absolute `fetch("/api/...")`
  leaves the preview proxy, and a relative `fetch("api/...")` breaks on nested client routes.
  The helper applies `appBasePath()` and keeps the preview working;
- it centralises error codes and JSON parsing, so pages do not reimplement them;
- it gives the analyzer a single, resolvable call target.

If native `fetch` is preferred, the rule stays "one transport": every internal call must go
through the shared base-path handling (`fetch(appBasePath() + "/api/...")` or an equivalent
path builder), and `fetch` outside the transport module is an error. The analyzer resolves the
configured transport module + export, so switching later is a config change, not a rewrite.

| Construct | Requirement | What the interpreter reads |
|---|---|---|
| transport spec | one module + one exported function; default `src/lib/api.ts` exporting `api` | imports/calls resolved to it; aliasing is followed |
| path expression | literal `"/api/..."`, concatenation with a static prefix, template with static segments, or a path builder imported from `src/lib/**` | static segments; dynamic segments become `{param}` candidates |
| dynamic-only path | variable/function result with no static prefix | `unknown` edge + diagnostic |
| any other network call | `fetch`, `XMLHttpRequest`, `axios`, `ky`, `got` outside the transport module | `client-transport` error; call still recorded as an unknown consumer |
| the transport module itself | the only place allowed to call `fetch` | not scanned as a consumer |

`defineApiPath` (a helper that declares the route id next to the path builder) is a possible
later addition if path builders make the link ambiguous; v0 should first see how far the
static-prefix contract goes.

### 3.4.1 Static screens (project-graph preview)

The project graph's page inspector is a **static structure view**, not a rendering. It reads the
explicit route table (`src/app.tsx`: `<Routes>` / `<Route>` imported from `react-router-dom`),
resolves each route element to its page file, and expands project page/layout/app components
through `Outlet` and JSX-valued props. UI primitives (`src/components/ui/**`), guards and
providers are leaves; the expansion has a depth budget, a structural node budget, cycle cuts and
marks conditional or `.map()` branches as dynamic. An unrouted page still gets a preview from its
own component.

Explicit navigation is read from `Link` / `NavLink` `to` and `useNavigate()` calls with a static
path; it is resolved through the route table to a target page. Guards, `<Navigate>` redirects and
the shared providers are deliberately not page links. The graph keeps page nodes only for
`src/pages/**`; component/lib files stay analyzer facts, not graph nodes.

Each preview node carries the static label the element renders, when it is readable: `text` for a
direct literal child, `tKey` for a `t("key")` child (D-043), and for a control whose label lives
in an attribute, `text` from `placeholder`, `aria-label`, `value` or `alt`. Intrinsic nodes are
emitted for the section intrinsics (`header`/`main`/`section`/`nav`/`aside`/`footer`/`form`/
`table`/`ul`/`h1`–`h3`) and for the content intrinsics: the copy-bearing block and inline text
elements (`p`/`span`/`strong`/`em`/`small`/`b`/`i`/`code`/`pre`/`blockquote`/`h4`–`h6`), the
controls (`button`/`a`/`input`/`select`/`textarea`/`label`) and the media elements (`img`/`video`/
`audio`). A copy-bearing text element that has no readable copy is flattened like its layout-only
siblings (`div`); a control is kept even without copy because it is a visible block. Content nodes
have their own bounded budget so they cannot starve the structural ones. Only direct children of
elements that already produce a node are read, so a flattened wrapper contributes no node and no
label. The IDE no longer draws the node tree: the page card and the inspector render a
**schematic mini-page** (`graph-page-sketch.ts`: the header/rail shell plus at most four coarse
regions — form, list, media, copy, a board per unexpanded component, one branch per run of
conditional alternatives — as a fixed-ratio wireframe with no labels), explicitly not the page's
CSS nor a mounted React tree (D-170, D-176). The labels above stay facts for other consumers (the
AI tools); the miniature does not print them.

### 3.5 i18n

`t("key")` literal calls; catalogs are JSON files. Dynamic keys are `unknown` (SPEC §9.3
rule 13).

### 3.6 Module facts (validator seam)

The AI patch validator no longer re-scans patched sources as text: it reads the same AST facts
as every other consumer. Each parsed source file contributes a `FileFacts`:

| Fact | Read from | Consumed by |
|---|---|---|
| `imports` (`specifier`, `kind`, `local`, `imported`, `source`) | `ImportDeclaration`, `export … from`, `import()`, `require()` | rules 7, 9, 12 |
| `translationCalls` (`key`, `source`) | literal `t("…")` / non-interpolated template; interpolated keys are skipped | rule 13 |
| `calls` (`name`, `source`) | bare-identifier calls (`drizzle(…)`, `t(…)`) | rule 9 |
| `handlerBodyRead` (on `RouteFact`) | `.body` member access or `{ body }` object-pattern in the handler | rule 8 |
| `input` (on `RouteFact`) | presence of `body`/`query`/`params` in the wrapper config | rule 8 |

The validator's `PatchContext` carries the **effective** analysis (patch already applied) plus
the pre-patch one for inverse edits; the IDE produces both with the one browser worker (the
pre-patch analysis is cached per VFS snapshot). If the analyzer is unavailable the IDE fails the
validation round closed with a `project-analysis` error — it never falls back to text scanning
and never skips a rule.

## 4. Static subset

```
StaticValue := string | number | boolean | null
             | template literal without interpolation
             | array<StaticValue>
             | object<StaticValue>                 // no spread/computed keys
             | const reference in the same module
             | imported const from a project module // one hop, alias-aware
```

Path expressions additionally allow `literal + expression` when the literal prefix has at
least one `/api/` segment; the expression becomes a dynamic segment. No general evaluation, no
loops, no function calls except the whitelisted DSL helpers.

Resolution depth: same file, one hop of project imports (and re-export chains); framework
package source is followed only for known packages. Everything else is `unknown`.

## 5. Interpreter passes

1. **Inventory**: all files, parse with the injected parser; keep path→source and content hash.
2. **Module graph**: `result.module` imports/exports; resolve relative, `~` and tsconfig paths;
   follow project re-exports; record unresolved specifiers.
3. **Routes**: for each route file, derive method/path from the filename using Nitro's rules;
   resolve the default export and its callee; read the config; classify `valid | invalid |
   unknown`; collect diagnostics. A route file that does not use the wrapper is still listed.
4. **Config**: find `defineConfig`; resolve the object; apply framework defaults; validate
   roles/permissions; expose the permission list to the route pass.
5. **Schema**: find `pgTable` calls; resolve imports; read names/columns/methods/policies;
   collect FK edges by resolving `.references(() => table.column)`; collect logical
   `relations(...)` edges in the same pass (or a separate `db/relations.ts`); merge re-exported
   framework tables; compute scope from config.
6. **i18n**: `t("...")` keys; catalogs.
7. **Module facts**: per-file imports, literal translation keys and bare calls; the seam the
   AI validator consumes instead of re-scanning text.
8. **Clients**: resolve the configured transport module/export; scan every file under
   `src/**`; detect calls to the transport (aliases followed) and any other network call
   (diagnostic); extract path expressions; inline one-hop path builders; match each static
   path against route templates (literal segments must match, dynamic segments match
   `{param}`); produce page→route edges, with `unknown` when the path cannot be resolved.
9. **Facts**: deterministic sort, revision hash, diagnostics.

All passes are pure functions over the file map; the parser is injected. The same analyzer runs
in the browser worker and in Node/CI.

## 6. Diagnostics and gate

| Code | Severity (gate) | Meaning |
|---|---|---|
| `config-missing` | error | `facilis.config.ts` is absent or not a `defineConfig` default export |
| `config-static` | error | a config value is outside the static subset |
| `config-invalid` | error | roles/permissions/defaultRole/locale cross-check failed |
| `route-wrapper` | error | route file's default export is not the resolved `defineAuthorizedHandler` call |
| `route-config-static` | error | config or a security field is not in the static subset |
| `permission-declared` | error | a route permission is not in `config.auth.permissions` |
| `db-tables-present` | error | `dbTables` missing |
| `db-tables-known` | error | a declared table is not in the schema |
| `db-columns-valid` | warning | malformed/unknown `table.column` |
| `body-validated` | error | handler reads body/query/params without the matching schema |
| `no-raw-db` | error | raw Drizzle import outside `@facilis.dev/db` |
| `schema-static` | error | table/column/policy uses a construct outside the DSL |
| `rls-on-scoped-table` | error | scoped table lacks `.enableRLS()` or a policy |
| `route-system-table` | warning | a route's `dbTables`/`dbColumns` names a system-only table outside an elevation |
| `fk-target-known` | warning | `.references` target is not a declared table/column |
| `relation-target-known` | warning | a `relations()` target is not a declared table |
| `client-transport` | error | a network call in `src/**` that does not use the sanctioned transport |
| `page-path-static` | warning | a page→route link cannot be resolved statically |
| `i18n-key` / `i18n-catalog` | warning | missing `t()` key or malformed locale JSON |
| `parse-error` | error | the parser rejected a source file; the pass keeps partial facts |
| `unknown` | info | a fact that could not be read; never silent |

The gate (CI/lint) fails on `error`. The IDE shows warnings live. Runtime auth stays the
security boundary: the analyzer only guarantees that introspection is complete, it does not
authorize requests.

**Implementation status (2026-11-04).** `@facilis.dev/analyze` implements the fact model and all
passes (config, routes, i18n, schema/DSL, relations, clients, per-file module facts, graph).
Package tests: 66, green; `typecheck`, `lint`, build and the 300-line check are green. Spike on
`examples/todo-app`: 443 files, 8 routes, 6 tables (including the re-exported `@facilis.dev/auth`
tables), 4 pages with calls, 18 graph nodes / 31 edges, 0 diagnostics. The IDE worker and the
`project-graph` tab are implemented on the same facts (lazy wasm worker + fullscreen graph +
`.facilis/graph/` state set); IDE tests/typecheck/lint/build and the browser smoke graph checks pass.

**Cutover (D-093).** The old scanners `packages/nitro/src/ast/**`,
`packages/ai/src/{scan,config-facts,schema-facts}.ts` are deleted. `@facilis.dev/nitro` maps
`RouteFact[]` to the manifest/OpenAPI contract (`route-metadata.ts`) with a parser injected from
`rolldown/utils` (`rolldown-parser.ts`), because the generated project's Vite config runs in the
WebContainer; `@facilis.dev/analyze/fs` is the parser-free Node loader. `@facilis.dev/ai`'s 19-rule
validator consumes the effective post-patch `Analysis` plus the pre-patch one; the IDE builds
both on its warm worker (`patch-analysis.ts`), caches the pre-patch analysis per VFS snapshot,
and fails closed with `project-analysis` if the analyzer is unavailable. `@facilis.dev/analyze` is
part of the generated project's vendored tarballs; its `oxc-parser` dependency is an optional
peer so the VM never installs it.

## 7. Graph model and UI

One graph over the whole fact set — tables, views, routes and pages together — not two separate
panels.

**Nodes**

- **table**: header (name, RLS badge, scope), column list (SQL name, type, PK/FK/unique/not-null
  markers), collapsible, unknown badge;
- **route**: method + path, the wrapper config's one-sentence description (clamped to two
  lines, D-129), permission, wrapper state (`valid | invalid | unknown`), request
  input flags (`body | form | query | params`), path parameters from the route template, source;
- **page** (only `src/pages/**`): file path, URL paths from the route table, call count, and a bounded static structure preview (nested components/sections plus content intrinsics — paragraphs, controls, media — each carrying its static `text`/`tKey` label, D-170); pages with no API calls are shown too;
- **view** (D-160, `db/views/**`): name, invoker/definer mode and declared permission, the base tables its `defineView` declares (collapsible), and the routes that use it.
- Nodes that are invalid or partially unknown are **shown** (red/hatched), never hidden: the
  graph is also the integrity view.

The **details inspector** (D-170) reads the rest of the same `Analysis`: a route's `dbColumns`,
`crossSite`/`rawSql`/handler reads, static db usage and elevations with their source lines; a
table's column defaults, policies and foreign keys; a page's static API calls; a workflow's derived
table surface. Source snippets are line-anchored off the cached project sources. This is view-only
detail: the node/edge contract does not change and no alternative view mode is added.

**Edges** — each kind has its own style and filter:

| Kind | From → to | Meaning |
|---|---|---|
| `fk` | table → table | physical foreign key from `.references`; label columns + onDelete |
| `relation` | table → table | logical edge from Drizzle `relations()`; one/many |
| `route-table` | route → table | solid for `dbTables`, dashed for `dbColumns`; `access: "elevated"` (one warning colour) when the table is in a `ctx.sudo`/`ctx.system` call |
| `page-route` | page → route | direct/indirect; dynamic links dashed/unknown |
| `page-link` | page → page | explicit `Link`/`NavLink`/`navigate` target resolved through the route table |
| `route-view` | route → view | a view named in the route's `dbTables` declaration (D-157); solid, `access: "elevated"` inside a `ctx.sudo`/`ctx.system` whose `tables` name it |
| `view-base` | view → table/view | base tables declared by `defineView.tables` (metadata only, D-097) |
| `route-permission` | route → permission | optional, later |

**Interactions**

- **Fullscreen**: a button turns the graph into a full-viewport overlay (CSS overlay; Esc
  exits), with the toolbar (filters, save, reset, fit, search) kept on top.
- **Filters**: show/hide each edge kind (and optionally each node kind); hidden state is
  persisted. Two persisted visibility filters remove the framework's own feature surface
  (D-163): **System routes** (`hideSystemRoutes`) hides routes the project does not declare —
  source under `node_modules/`, or (wrapper known) no `dbTables` entry naming a
  project-declared relation (a non-framework table or any view); **Unused system tables**
  (`hideSystemTables`) hides framework tables (declared by installed `@facilis.dev/*` packages,
  source under `node_modules/`, the `sistema` badge) that no non-system route reaches with a
  `route-table`/`route-view` edge, so a framework table the project's own routes use (e.g.
  `facilis_files` from the todo routes) stays visible. Unknown/invalid routes are never
  hidden: the graph is also the integrity view. Hidden nodes and every edge touching them are
  removed from the drawn view, the automatic layout is computed from the visible nodes while
  saved positions of the remaining nodes are kept, and `ProjectGraphStats.hiddenNodes` counts
  them. Both filters default to **off**; the route filter is a heuristic (a project route that
  touches no DB relation is classified as system) and can simply be left off.
- **Drag**: nodes are draggable and follow the pointer live; the position is committed on drop.
  Initial positions come from a deterministic layered layout (pages → routes → tables, with views
  below the tables in the schema column; FK/relations among tables). "Reset layout" returns to it.
- **Free attachment**: edges are floating — an endpoint is the intersection of the node
  rectangle with the centre-to-centre line, recomputed from measured bounds while dragging, so an
  edge can leave/enter any side; a self-reference loops.
- **Curves**: selecting an edge reveals a midpoint handle; dragging it stores a per-edge
  `edgeCurves` offset. Double-click straightens the edge, "Reset layout" clears the curves too.
- **Notes**: markdown annotations are free-floating nodes (`note:<uuid>`); the body is one
  markdown file, double-click edits it, the card renders the markdown.
- **AI**: `graph_state` reads nodes/edges/notes with positions; `graph_arrange` applies moves,
  bends, notes and visibility, validated and capped, then the open panel reloads.
- **Navigation**: pan/zoom/fit/minimap, node search, click node/edge → inspector + source jump,
  reverse lookups ("used by").
- **Performance**: React Flow with memoised nodes, `onlyRenderVisibleElements`, collapsed
  column lists when zoomed out; a few hundred nodes must stay usable.

**Persistence to a committed file set**

Diagram state (layout, bends, filters and team annotations) is saved through the kernel
(`kernel.writeFiles`, invariant 7), debounced, into `.facilis/graph/` (D-126). It is split so
that git merges per element: one settings file, one small JSON file per position or bend, one
markdown file per note, and pan/zoom kept local.

```text
.facilis/graph/layout.json             { "version": 3, "hiddenEdges": [...], "collapsed": {...},
                                         "hideSystemRoutes": false, "hideSystemTables": false }
.facilis/graph/positions/<key>.json    {"id":"table:todos","x":10,"y":20}     one per node/note
.facilis/graph/bends/<key>.json        {"id":"fk:table:todos:…","x":24,"y":-40}   one per edge
.facilis/graph/notes/<uuid>.md         # Annotazione   (one markdown file per note)
.facilis/graph/viewport.json           { "x": 0, "y": 0, "zoom": 0.8 }   (git-ignored)
```

- `.facilis/.gitignore` keeps `*` and gets an idempotently appended allowlist (`!graph/`,
  `!graph/**`, `graph/viewport.json`): the graph is committable while the rest of `.facilis`
  (database snapshot, binary blobs, logs — D-052) stays local. The file is extended, never
  rewritten.
- One element per file **is** the merge strategy: independent edits (two different nodes, two
  notes) merge automatically — a single JSONL file conflicted as soon as the changed lines were
  adjacent, which is why this is per element. Only the same element leaves a conflict, on one
  small file, and the conflict is readable.
- `positions/<key>.json` doubles as a note's geometry: the note body is `notes/<uuid>.md`, so
  moving and editing it are independent edits. A note without a saved position is parked at a
  deterministic fallback instead of being dropped.
- `bends/<key>.json` are keyed by the stable edge id; a missing file is the automatic path.
  Schema version 1/2 files (the single `.facilis/graph.json`, no notes) are read once through
  migration and rewritten as v3; stale edge ids are ignored.
- `hideSystemRoutes`/`hideSystemTables` are **additive** view preferences: default `false`,
  version stays 3, and a layout written without them reads as show-everything. "Reset layout"
  keeps them exactly like `hiddenEdges`; a hidden node keeps its saved position, so turning a
  filter back on restores the arrangement instead of dropping the node.
- IDs are the stable fact IDs (`page:<path>`, `route:<METHOD> <path>`, `table:<name>`); ids
  that no longer exist are ignored on load, new nodes get auto positions.
- Missing/corrupt state → auto layout + warning; the state is never an input to validation.
- The AI source-patch allowlist does not include it: models cannot rewrite project source
  through the graph. The chat's `graph_state`/`graph_arrange` tools write this diagram state
  only (validated, capped) and are not the §9.3 patch flow; a successful write refreshes the
  open panel through the `graph-live` event.
- `.facilis/` remains excluded from export, publish and the search index: the graph files are
  team state for the repository, not shipped app content.

Graph building is a pure function over the facts; layout persistence is UI state. Both are
testable without a dev server.

## 8. Module resolution scope (zero build)

- Project files: relative imports, `~`, tsconfig `paths`; `.ts/.tsx/.js/.jsx/.mts/.mjs`,
  `/index`.
- Re-exports and barrel files: followed.
- Framework packages: `@facilis.dev/*` source is shipped in the package, so it can be parsed
  when present (the Node loader walks `node_modules/@facilis.dev`). The browser IDE's file map
  comes from the VFS index, which skips `node_modules`, so it inlines the table-bearing
  packages (`auth`, `db`) at build time instead (D-130); a drift guard keeps that list in
  step with the template.
- Other packages (including `drizzle-orm`): not parsed; their DSL is modelled by the
  whitelist.
- No dynamic import execution, no `require` evaluation, no `node_modules` crawl beyond what a
  known package needs.

## 9. Fixture matrix (the contract's test plan)

| # | Input shape | Expected fact | Expected diagnostic | Graph behaviour |
|---|---|---|---|---|
| 1 | `export default defineAuthorizedHandler({...}, h)` | route valid | none | route node |
| 2 | `const h = defineAuthorizedHandler({...}); export default h` | route valid | none | route node |
| 3 | `const config = {...}; defineAuthorizedHandler(config, h)` | resolved | none | route node |
| 4 | imported `dbTables` const (one hop) | resolved | none | edges |
| 5 | spread `...common` in config | unknown field | `route-config-static` | route node + unknown |
| 6 | computed key in config | unknown field | `route-config-static` | route node + unknown |
| 7 | local shadowing `function defineAuthorizedHandler()` | invalid | `route-wrapper` | red route node |
| 8 | raw `export default async function` | invalid | `route-wrapper` | red route node |
| 9 | `pgTable("todos", {...})` + `.enableRLS()` + policies | table/columns/policies | none | table node |
| 10 | `.references(() => projects.id, { onDelete: "cascade" })` | FK fact | none | FK edge |
| 11 | re-exported `@facilis.dev/auth` table | framework table | none if resolved | table node |
| 12 | custom column builder | partial column | `schema-static` | column + unknown |
| 13 | dynamic table name | no name | `schema-static` | table placeholder |
| 14 | `api("/api/todos")` | page→route direct | none | edge |
| 15 | `api("/api/todos/" + id)` | dynamic segment matches `{id}` | none if unique | edge |
| 16 | path builder imported from `src/lib/**` | inlined path | none | edge |
| 17 | fully dynamic path | unknown edge | `page-path-static` | dashed/unknown edge |
| 18 | `fetch("/api/...")` outside the transport module | consumer + violation | `client-transport` | edge + red |
| 19 | orphan table / route / page | fact present | info | node with no edges |
| 20 | invalid TS syntax | partial/unknown | parse diagnostic | placeholder node |
| 21 | `relations(t, ({ one }) => ({ owner: one(users, { fields: [t.ownerId], references: [users.id] }) }))` | logical relation | none | `relation` edge (one) |
| 22 | `relations(t, ({ many }) => ({ items: many(items) }))` | logical relation | none | `relation` edge (many) |
| 23 | relation target not resolvable | unknown | `schema-static` (or relation-specific) | node + unknown edge |
| 24 | `fetch(appBasePath() + "/api/todos")` inside the transport module | allowed implementation | none | not a consumer |
| 25 | `dbColumns: ["todos.dueDate"]` | property key, SQL name `due_date` derived | none | table/column edge/label |
| 26 | `import { api as request } from "./lib/api"` | resolved transport | none | edge |

Each fixture is run through the parser adapter(s) with a golden JSON fact snapshot; a subset is
also compared with the runtime manifest/OpenAPI/schema as a **test oracle** (not a runtime
dependency).

## 10. Open decisions

Decided (2026-11-04): `dbColumns` = Drizzle property names; both FK and `relations()` edges;
parse `@facilis.dev/*` source; one full-screen graph with filters/drag/persistence; one sanctioned
client transport (`api()`) with everything else blocked; the graph state is committed team
state under `.facilis/graph/` (D-126), with pan/zoom local.

Still open:

1. **Strictness**: which `unknown` is an error at the gate; default: security fields error,
   display fields warning.
2. **Relations**: is `relations()` optional (logical edges appear only if declared) or
   mandatory for every FK? Recommended: optional, FK remains the physical truth.
3. **Auto-layout**: custom deterministic layered layout vs a dependency (`dagre`/`elkjs`).
   Decide in the graph spike; manual positions take over after the first drag.
4. **Column-level edges**: FK edges can be column→column; route→column edges from `dbColumns`
   can be column-level too. Decide whether the graph draws and filters at table or column
   granularity.
5. **Package boundary and name** (`@facilis.dev/analyze`), and whether the contract lives in SPEC
   or in a dedicated doc (this one).

## 11. Next steps

1. ~~Freeze this contract and write the fixture matrix as the acceptance test.~~ Done.
2. ~~Spike the analyzer on `examples/todo-app`.~~ Done (see status).
3. ~~Extract `@facilis.dev/analyze` with the parser adapters; replace `nitro/src/ast` and
   `ai/src/{scan,config-facts,schema-facts}`.~~ Done (D-093).
4. ~~Build the schema + API graph view from the facts.~~ Done (`project-graph` tab, D-092); the
   API Flow was then removed (D-095), so the graph is the only visualizer. The Data Explorer
   reads the live schema through a kernel-mediated same-origin dev proxy (D-097), which works
   with a popped-out preview; O-011 keeps the declared-AST half and preview mode C.
5. Wire the CI/lint gate to the analyzer diagnostics (the IDE graph shows them; a failing gate is
   still open).
6. ~~Replace the remaining text scanners.~~ Done: the Release Preview reads the ref's
   `db/**` sources and `facilis.config.ts` through the analyzer; `release-schema.ts` is only a
   mapping (D-094). The consumer scan was removed together with the API Flow (D-095).
