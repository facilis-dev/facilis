# D-211 — The project graph is a map-and-lens canvas; diagnostics are analyzer codes resolved via i18n
**Status:** accepted (2026-11-25)

**Context.** The project graph is unusable in daily use. The canvas-first layered-lenses epic
(#56) was consolidated (PR #154) and then fully reverted (PR #156): fit opened at ~0.06 zoom
with overlapping cards (PR #155 reserved up to 40% of canvas width per side), pan/drag sprang
back (#145), the HUD overlapped itself (#144), and a lens gave no visible feedback (#146).
`main` therefore carries the pre-epic graph: four fixed columns (a "vertical ladder"),
8-11px micro-text at fit, a permanent 320px inspector, and structural cost problems — a full
view-model rebuild per keystroke/gesture-end/selection, every edge re-rendered per pan frame
(`ProjectGraphEdge.tsx` `useViewport()`), O(T^2 log T) table ordering, and fit-to-view at
`minZoom 0.05` defeating virtualization so all heavy cards mount at once. An interactive
static preview (`spikes/graph-redesign-preview/`, branch `spike/graph-redesign-preview`,
commits f9b3252..24b3fad) was reviewed with the maintainer and approved as the direction;
epic #182 carries the plan. This decision records the contract choices every child of #182
must obey.

**Evaluation.**

- *Renderer.* #56 kept React Flow and asserted "the bottleneck is hierarchy and encoding, not
  frame rate". The audit of current `main` contradicts the second half: per-frame edge
  re-render and whole-model rebuilds make interaction cost proportional to the entire graph.
  The preview renders one Canvas2D surface with viewport culling and a dirty-only redraw loop
  and holds ~60fps at 1300 nodes / 1700 edges, including on emulated mobile touch. Hierarchy
  and encoding remain the primary fix; the renderer change removes the residual per-frame
  cost that React Flow's DOM/SVG model imposes here. A canvas surface also makes semantic
  level-of-detail and in-place highlights cheap (no per-node DOM to reconcile).
- *Hierarchy.* Showing every node at once is the core usability failure. The preview validates
  a two-level map: an overview of one card per domain (grid, aggregate cross-domain links whose
  thickness is coupling) and a drill-down detail of horizontal swimlanes
  pages | routes | data (+ workflows). Cross-domain references stay visible as labelled ports
  with counts, so a shared node is never duplicated or lost. The same spatial layout is kept
  on mobile (pan instead of reflow); a vertical reflow was tried and rejected because it
  collapsed distinct edges into a single spine.
- *Stability.* Layout is computed once per dataset/domain and cached; pan/zoom is a pure camera
  transform; nodes are draggable and snap to their column on release; positions persist under
  `.facilis/graph/` (D-126) and the saved viewport is preserved (D-127). This removes the
  index-placed row shifts and the snap-back of #145 by construction.
- *Lenses.* Separate modes failed (#146: pressing a lens changed nothing). Lenses become
  in-place highlights (security / elevated / shared / unknown) with an explicit banner, colour
  legend, count, per-domain badges and a clickable answer list; zero matches is an explicit
  empty state. Nodes never move under a lens (spatial constancy).
- *Messages.* Per the repo invariant "codes, not prose", the analyzer emits diagnostic codes
  plus structured params (e.g. `graph.diag.publicWrite {method}`, `graph.diag.tableNoRls
  {table}`, `graph.diag.shared {count,domains}`); the UI resolves them with `t(code,params)`
  from `ide/src/i18n` (D-043). No component hardcodes user-facing prose. The preview models
  this with an en/it bundle and a live language switch.

**Decision.**

1. The project graph surface is a Canvas2D renderer (port of the validated preview) replacing
   the React Flow panel; React Flow is retired from the graph (child #192). Other IDE surfaces
   are unaffected.
2. Hierarchy is map-and-lens: domain overview grid + drill-down swimlane detail + labelled
   cross-domain ports; identical spatial layout on all screen sizes.
3. Layout/viewport stability rules: cached layout, pure-transform camera, drag with column
   snap, persisted positions and viewport (D-125/D-126/D-127).
4. Lenses are in-place highlights with explicit feedback and empty states; they never move
   nodes and never hide context (dim, not remove).
5. Analyzer-derived messages are codes + params resolved via i18n; lens and diagnostic text
   lives in `ide/src/i18n` keys.
6. HUD/drawer reserve their space in fit and never overlap content (regression tests for
   #144/#155); the inspector is a floating dismissible drawer / mobile bottom sheet.

**Consequences.** SPEC §10 is updated by #192 to describe only the new surface. The twelve
review questions (Q1-Q10, Q16, Q17) become the acceptance criteria of #190 and the epic.
Phase-2 capabilities (column-level impact, runtime lens on D-200, timeline/agent diff, role
reachability, prerender lens, search-by-permission, matrix, export) are explicitly out of
scope for #182 and will be planned only after it closes.
