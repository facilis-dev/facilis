# D-214 — The canvas graph ships no note annotations; note files stay preserved
**Status:** accepted (2026-11-25)

**Context.** D-126 made notes part of the project graph: free-floating markdown marks stored as
`.facilis/graph/notes/<uuid>.md`, with their positions in `positions/<key>.json`, edited on
the React Flow canvas and by the AI graph tools (D-171). D-211/D-213 replaced that canvas with
the Canvas2D map-and-lens surface, which draws domains, nodes, edges, lenses and diagnostics but
not notes. The toolbar still offered "Add note" and the panel still treated "only notes" as a
non-empty graph, so the action wrote files nobody could see: an invisible action in the sense of
the epic's UX rule. The layout hook also exposed `createNote`/`moveNote`/`editNote`/
`deleteNote` that no production module called.

**Decision.**

1. The canvas surface ships **no note annotations** in epic #182: no "Add note" toolbar action,
   no note mutation callbacks in `useProjectGraphLayout`, and no "notes are content" exception
   in the empty state. A graph with no nodes is empty even if note files exist.
2. Note files remain part of `.facilis/graph`: `graph-layout-io`, `graph-layout-files`,
   the `graph-layout.ts` note codecs and `layout.notes` loading/saving are unchanged, and the
   AI graph tools keep using them (D-171). Existing `.facilis/graph/notes/*.md` files load and
   are re-saved unchanged; a round-trip test in `graph-layout-io.test.ts` proves it.
3. Editing notes from the UI returns in a follow-up (a surface that renders them). Until then
   the app must not expose an action that writes invisible state.

**Consequences.** No dead toolbar action and no unreachable mutation API; note state stays
merge-friendly team state (D-126) and is not lost or rewritten by this epic. A future notes
surface can reuse the persistence layer and the AI tools without a migration.
