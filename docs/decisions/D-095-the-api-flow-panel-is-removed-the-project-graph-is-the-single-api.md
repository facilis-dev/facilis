# D-095 — The API Flow panel is removed; the project graph is the single API/schema visualizer

**Status:** accepted (2026-11-06)

D-085/D-087 shipped an API Flow that rendered `/_openapi.json` through the preview proxy and
scanned `src/**` for consumers. D-092 then added the project graph: the same pages → routes →
tables structure (plus FK/`relations()` edges) from `@facilis.dev/analyze`, with no runtime
endpoint, no preview and no polling. Keeping both duplicated the visualizer and the
route/page/table model, while the OpenAPI-driven one only works while the project is reachable
through the Studio's preview frame — when the app is opened in its own tab (and in the isolated
preview modes) the Studio's fetch to the preview origin is cross-origin and the panel degrades
to "unreachable". The AST graph does not have that failure mode.

**Decision.** Remove the whole API Flow surface: `ApiFlowPanel` and its four subcomponents,
`api-flow-{client,model,parse,tables}.ts` (+ tests), the `manifest-consumers` scan it used,
the `api-flow` synthetic tab (controller method, tab kind, editor rendering, breadcrumb/title),
its `activity.apiFlow` button, the `en/it-api-flow.ts` catalogues, the browser-smoke block and
the `05-api-flow.png` artifact. `/_openapi.json` stays a framework endpoint (SPEC §6.9): it is
still the published API contract for the generated app and external tooling; only the Studio
panel goes. The project graph is the single visualizer: it answers the page → route → table
question from AST facts and works with no booted app.

**Data Explorer is not removed.** It keeps the live code ↔ DB drift, but its transport is the
remaining reachability question: it builds `/__facilis/dev/schema` from the preview iframe URL,
so it needs a live preview tab and a same-origin preview (mode A). It does not work when the app
is opened in its own isolated tab, and its declared half duplicates the analyzer. Recorded as
O-011 with the proposed direction: declared tables from AST immediately, live drift through a
kernel-mediated dev proxy (the Studio already hosts the kernel) instead of the preview frame,
so no preview is needed to connect; the PGlite-snapshot alternative is rejected (stale data,
a second Wasm instance, unsafe concurrent writers). Not implemented in this change.

**Consequences.** One visualizer, one graph model (D-092). The IDE loses OpenAPI-driven consumer
attribution; the project graph's page/route/table structure already covers the structural view.
The tab kinds become text/image/directory/diff/notebook/commit-graph/project-graph. The manifest
consumer scan is deleted, closing the D-094 rename follow-up by removal. The i18n catalogues
shrink by the API Flow block, and no IDE code reads `/_openapi.json` anymore. O-011 is the next
step for the Data Explorer.

**Verification.** IDE 80 files / 619 tests, typecheck, lint (0 errors), `build:app`,
file-length (764 files) and theme checks green; root `lint`/`typecheck`/`test`/`build` green.
Browser smoke re-run with the API Flow block removed: 95 checks pass, including the project
graph and the Release Preview; the 11 failures are all in the pre-existing chat flow (provider/
settings selection plus its downstream proposal/apply/undo checks and the two global console/
request checks they trip). Chat is currently known-broken and out of scope for this change;
every non-chat check passes.
