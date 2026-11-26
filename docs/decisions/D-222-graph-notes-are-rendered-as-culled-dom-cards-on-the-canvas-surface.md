# D-222 — Graph notes are rendered as culled DOM cards on the canvas surface
**Status:** accepted (2026-11-26)

**Context.** D-126 made notes part of the project graph: free-floating markdown marks stored as
`.facilis/graph/notes/<uuid>.md`, with their positions in `positions/<key>.json`, edited on
the React Flow canvas and by the AI graph tools (D-171). D-219/D-221 replaced that canvas with
the Canvas2D map-and-lens surface, which for the first cut drew domains, nodes, edges, lenses and
diagnostics but not notes; the invisible "Add note" action was therefore removed. Issue #194
restores the feature on the new surface.

**Decision.**

1. Notes are presented as **DOM cards over the canvas**, not painted into it: a Canvas2D card
   cannot host a textarea, selection or an accessible name. Each card is positioned from the
   draw loop by writing `style.transform`/`visibility` — never a React render per frame, never
   a camera or layout mutation — so panning and zooming keep the cards anchored.
2. A card is drawn only when its rectangle intersects the **visible content box** of the current
   scene (insets excluded). Notes live in the detail scene's coordinate space, where the legacy
   positions came from, so a note does not float into an unrelated view.
3. Creating a note places it at the centre of the visible content box and opens the editor;
   editing commits on blur or Cmd/Ctrl+Enter, Escape cancels, a committed empty note is deleted
   rather than persisted, and dragging the header moves the note (mouse and touch) without
   moving nodes.
4. The `.facilis/graph/notes/<uuid>.md` format, the `positions/<key>.json` merge rule and the AI
   graph tools are unchanged: no migration, and the byte-for-byte load/save round-trip test stays.
5. Notes appear in the surface's sr-only node list, one button per note, so keyboard and screen
   reader users can reach them.

**Consequences.** Notes keep the D-126 team-state contract while becoming visible and editable
again. The DOM overlay reuses the draw loop the rich-card placement already relies on, so a
future overlay (comments, annotations) has a pattern to follow without touching the renderer.
