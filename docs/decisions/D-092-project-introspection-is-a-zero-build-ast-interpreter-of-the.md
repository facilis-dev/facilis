# D-092 — Project introspection is a zero-build AST interpreter of the framework DSL, rendered as one graph

**Status:** accepted (2026-11-04)

The Studio and the AI layer learn the project's schema and API surface from dev-only runtime
endpoints (`/__facilis/manifest`, `/_openapi.json`, `/__facilis/dev/schema`). That couples
introspection to a booted Vite/Nitro/PGlite runtime, and the same facts are re-read by four
different text scanners (`packages/nitro/src/ast`, `packages/ai/src/{scan,config-facts,schema-facts}`,
`ide/src/facilis/release-schema.ts`, `ide/src/facilis/api-flow-consumers.ts`). The scanners
disagree (property vs SQL column names, spoofable AI rules, route forms the manifest misses),
and the panels degrade exactly when the project is broken. The spec's "everything is code" rule
makes the declarations the source of truth; it does not require executing them to read them.

**Decision.** Add `@facilis.dev/analyze`, a browser-safe package that interprets the framework's
declarative DSL with an injected parser and **zero build-time execution** of project code. It
produces one fact model (routes, config, tables/columns/policies, FK and `relations()` edges,
i18n, client consumers, diagnostics) and one project graph.

- **Parser.** `oxc-parser` behind the injected `Parser` contract: the Node/CI adapter uses the
  native/wasm build, the Studio worker uses the browser wasm entry. The generated project keeps
  its existing rolldown/oxc pass until the WebContainer wasm path is proven; the AST shape is
  normalized to the repo's structural node helpers. The parser is pinned with the bundler's oxc
  generation where practical.
- **DSL contract.** Routes must default-export the `@facilis.dev/core` `defineAuthorizedHandler`
  call; config is `defineConfig`; schema is `pgTable` plus the whitelisted column builders,
  methods and policy helpers; client calls go through the single `api()` transport; i18n uses
  literal `t()`. Values are read through a bounded static subset (literals, same-file consts
  and one-hop project imports, static templates/arithmetic). Anything else is an explicit
  unknown, never an empty value: `dbTables === null` is unknown, while `[]` is "no DB".
- **Relations.** `.references(...)` (physical FK) and Drizzle `relations(...)` (logical
  one/many) are distinct edge kinds. `dbColumns` and `ScopeFact.column` use Drizzle property
  names; the SQL name stays on the column fact. Framework tables reached by re-export are read
  from the installed `@facilis.dev/*` source.
- **Graph.** One editor-area graph (pages → routes → tables, plus table→table FK/relation
  edges), not two panels: fullscreen, per-edge-kind filters, draggable nodes, auto-layout with
  manual override, source jumps, integrity badges. The layout is local editor state in
  `<project>/.facilis/graph.json` (gitignored), written through `kernel.writeFiles`; it is
  never an input to validation and never AI-writable.
- **Diagnostics.** The analyzer reports codes with severity (`route-wrapper`,
  `route-config-static`, `permission-declared`, `db-tables-present`, `db-tables-known`,
  `body-validated`, `no-raw-db`, `schema-static`, `rls-on-scoped-table`,
  `fk-target-known`, `client-transport`, `page-path-static`, `i18n-key`,
  `config-*`, `parse-error`, `unknown`). The CI/lint gate fails on errors; the IDE shows
  them live. Runtime `defineAuthorizedHandler` stays the security boundary.

**Rejected alternatives.** *Annotations/JSDoc as a second source of truth*: text, forgeable,
omitted by models, and it duplicates the executed wrapper. *Build-time evaluation of config/
schema*: faithful but re-introduces a build step and cannot work for old git refs in the
browser; the bounded DSL interpreter keeps the zero-build property. *Keeping endpoints as the
only source*: boot-coupled and the four scanners already disagree. *One parser for the
WebContainer too, now*: the oxc-parser VM path relies on a runtime package download and
`node:wasi`, unverified; the normalized AST contract keeps that migration open. *Free-form
Drizzle re-implementation beyond the whitelist*: unknown is safer than a guessed type.

**Consequences.** One fact model replaces the text scanners (they are deleted once parity tests
pass); the IDE and AI can work with the dev server down; endpoints remain for live state
(catalog/drift/boot) and as the runtime oracle for divergence tests. The analyzer owns a small
DSL interpreter whose maintenance is the schema whitelist and the static subset; a parser
version bump is a deliberate change with fixture tests. The Studio pays a lazy-loaded wasm
worker (oxc wasm + one emnapi pin) and a startup analysis of the project's source files. The
DSL restrictions are enforced by the gate, so a project that steps outside the contract gets a
diagnostic instead of silently missing facts.

**Verification.** `@facilis.dev/analyze`: 60 tests green (config/routes/i18n/schema/relations/
clients/graph + module graph/static eval), `typecheck`, `lint`, build and the 300-line check
green. Spike on `examples/todo-app`: 443 files, 8 routes, 6 tables (including re-exported auth
tables), 4 pages with calls, 18 graph nodes / 31 edges, 0 diagnostics; the fixture project
covers invalid routes, const/imported config, FK + both relation kinds, path builders and the
transport violation. The IDE side is implemented on the same facts: a lazy wasm worker
(`analyze-worker` + 1.5 MB `parser.wasm32-wasip1` asset, one pinned emnapi pair) and the
`project-graph` editor tab (fullscreen, edge filters, drag, `.facilis/graph.json`). IDE
typecheck, 83 test files / 642 tests, lint, theme and build are green. The browser smoke run
passes the new graph checks end to end in the real Studio (activity → panel → worker →
tables/routes/pages rendered); its four failures are the unrelated chat provider/settings
checks, outside this change.
