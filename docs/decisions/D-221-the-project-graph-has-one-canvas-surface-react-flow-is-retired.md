# D-221 — The project graph has one canvas surface; React Flow is retired
**Status:** accepted (2026-11-25)

**Context.** D-219 replaced the project graph's renderer with a Canvas2D map-and-lens
surface. Children #183-#191 landed the new surface beside the old one, so
`ide/src/components/ide/` carried two graph implementations: the live
`ProjectGraphSurface` and the superseded React Flow panel (`ProjectGraphCanvas`,
`ProjectGraphNodes`, `ProjectGraphViewNode`, `ProjectGraphRouteNode`,
`ProjectGraphNodeChrome`, `ProjectGraphNote`, `ProjectGraphEdge`,
`project-graph-flow-nodes`). The old stack was already unreachable — no production module
imported it — but it still compiled, linted, tested and appeared in SPEC §10 and
`ide/README.md`. Its performance pathology (per-frame edge re-render through
`useViewport()`, whole-model rebuilds) is what D-219 retired.

**Decision.**

1. The canvas surface is the only project-graph implementation. The eight superseded React
   Flow modules are deleted; `ProjectGraphPanel.tsx` is the surface host, not a second
   renderer. No component imports React Flow for the project graph.
2. What is kept is contract, not renderer: the `@facilis.dev/analyze` graph facts and
   `graphDiagnostics` (D-092, D-220); the `.facilis/graph` layout, viewport and note state
   with its AI tools (D-126, D-171); the new surface (`graph-surface/*`, lens, answers and
   rich-card modules); and shared helpers still imported by live code
   (`project-graph-edges.ts`, `graph-edge-geometry.ts` through the graph scene,
   `xyflow-theme.ts` through the commit graph).
3. `@xyflow/react` stays: the commit graph (`CommitGraphPanel`/`CommitGraphCanvas`,
   D-088) still uses it. The project graph no longer does; retiring the dependency would be
   a commit-graph change, not a project-graph change.
4. SPEC §10.2 and `ide/README.md` describe the canvas map, the in-place lenses and the
   analyzer diagnostics only. `ide/I18N.md` tracks the same surface, and the graph
   catalogues carry no key that only the removed components used.

**Consequences.** One graph implementation to maintain: the eight-file legacy cluster no
longer compiles, lints or ships, and the UI cannot drift back to a second renderer. The
D-126/D-219 state contract is unchanged, so layouts written by earlier builds still load.
Future renderer and performance work reads `graph-surface/*` only.
