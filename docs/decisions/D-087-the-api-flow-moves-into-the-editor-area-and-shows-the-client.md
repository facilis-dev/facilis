# D-087 — The API Flow moves into the editor area and shows the client consumers of each route
**Status:** superseded by D-095 (2026-11-06); kept as history
**Originally:** accepted (2026-11-02)

D-085 put the API Flow in the sidebar. At the Explorer's 16% width a 7-route graph already
rendered unreadably: the node cards grew past their fixed row height and overlapped, and the
canvas had no room for pan/fit. The panel also only showed the server side — the routes and the
tables — so the question the graph exists to answer, "which page calls this API?", was not on
screen. SPEC §10.2 had originally called for a new tab kind; the sidebar was the shortcut.

**Decision.** Make it a real editor-area tab with pages on the left, and scan the project for
the files that call each route.

- **Editor tab, not a sidebar view.** A synthetic `vv-api-flow` tab (no backing file, like the
  diff tab) rendered by `EditorGroup`; the ActivityBar button opens/focuses it and its title is
  the translated "API Flow". The sidebar branch and the `api` activity view are gone, so there
  is one surface per panel. The tab is closed/reopened like any other tab, and the synthetic
  helpers live in `vv/synthetic-tabs.ts` because the controller is pinned by the file-length
  ratchet. Release Preview stays in the sidebar: it is a list/diff view, not a graph.
- **Three columns, fixed sizes.** Pages (client files) on the left, routes in the middle,
  tables on the right. Routes are split over up to four vertical lanes (resources are packed
  greedily so the lanes stay even) instead of one very tall column that fitView turns into a
  thumbnail. Node rectangles never share a slot: the layout stacks rows from exported
  `FLOW_NODE_SIZE` values, a unit test asserts no two node rectangles overlap, and the graph is
  fitted on open/refresh (a ResizeObserver refits it when the window or the side panels change).
- **Consumers.** The panel reads the project's `src/**` files from the VFS (bounded: 300 files /
  300k chars) and `scanManifestConsumers` (named `scanApiConsumers` then) matches literal `/api/…` references to the operations:
  direct references, template literals matched by their static prefix, a one-hop import graph
  (alias `@/` and relative) so pages that call `src/lib/api.ts` are attributed to the routes,
  and dynamic segments matched against `:id`/`[id]`/`{id}`/`*`. Page nodes are connected to
  their routes (dashed when the link is indirect); a route no file references is flagged
  "unused".
- **Inspector + list.** Clicking a node opens a right-hand inspector overlay with permission,
  tables, source file and the consumers list; "Open file" jumps to the route/page/table source.
  A list toggle shows the same data as a compact table for projects with many routes, a filter
  narrows by path or method, and one focus control hides the sidebar, the preview and the
  bottom panel so the graph gets the window back (the panel does not force that state).

**Rejected alternatives.** Keeping the sidebar and only fixing the layout: 300 px is not enough
for a three-column graph, and the user asked for the center. A dock toggle center↔sidebar: it
needs two mounted surfaces and a persisted placement for a mode nobody has asked to keep; the
tab is closable, which covers "I don't want it open". A full AST pass for consumers: the IDE
would need the Node-only TypeScript parser; the one-hop text scan covers the template and is
cheap, and its limits are declared. Synthesizing consumer edges from stack traces or the dev
server request log: not available in a static build and not durable.

**Consequences.** The graph is readable at the center width and page→route→table flows read
left to right. The scan is textual, so an URL built dynamically, an import chain longer than one
hop, or a consumer outside `src/` is missed; "unused" is a hint, not a proof, and the UI says
so. The scan re-runs only when the project's revision changes (or on refresh), and the file read
budget bounds its cost on large projects. Synthetic tabs are not restored across a page reload
(no open tabs are), and the tab is not draggable to the sidebar. The i18n block grew by the
inspector/list strings, still spread from en/it-api-flow.ts. Uncovering focus mode exposed a
latent AppShell race: restoring a collapsed sidebar ran the auto-widen effect before the
resizable-panels layout had registered, and `panel.getSize()` threw "Layout not found" and took
the shell down. The effect now defers to the next frame and retries a few times.

**Verification.** 10 consumer-scanner tests (direct, template, dynamic segment, alias/relative
import, prefix-only-if-dynamic, ignored dirs, dedupe, unused) and 10 model tests (ordering, three
columns, pairwise non-overlap, page nodes/edges, consumer data, table usage, determinism,
warnings); the IDE suite is 575 tests. The full gate set is green, and the browser smoke asserts
the panel lives inside the editor group (center, not sidebar), that route/table/page nodes render,
that focus mode hides the side panels and widens the graph past 500 px, that selecting a route
opens the inspector and its "Open file" reaches the route source, and that the list toggle
switches the view.
