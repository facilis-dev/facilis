# D-125 — The project graph is a primary development surface: live drag, free attachment, editable curves
**Status:** accepted (2026-11-08)

The graph was a schematic: edges only left/right with smoothstep corners, a controlled React
Flow node list that snapped into place on drop, and route cards that did not show the request
shape. Using the graph alongside chat as the main development surface needs it to feel direct.

**Decision.** The graph canvas is interaction-first:
- **Live drag.** Nodes are local React Flow state (`applyNodeChanges`): the card follows the
  pointer and the committed position is written to `.facilis/graph.json` on drag stop only.
- **Free attachment.** Edges are floating: an endpoint is the intersection of the node rectangle
  with the centre-to-centre line, recomputed from measured bounds while dragging, so an edge can
  leave and enter any side (a self-reference loops) as the layout grows in every direction.
- **Editable curves.** The edge path is a cubic bezier; selecting an edge reveals a midpoint
  handle that drags a per-edge offset, persisted as `edgeCurves` in the layout file (schema v2;
  version 1 files still load). Double-click straightens an edge; "Reset layout" clears positions
  and curves. The layout stays local editor state (D-052/D-092), never project source.
- **Route input in the graph.** `RouteNodeData` gains the analyzer's `input` presence facts
  (body/form/query/params) and the IDE derives path parameters from the route template; route
  cards show them as chips, so the graph is also the API-contract view.

**Consequences:** no new project file and no new write path (the existing layout writer gains one
schema version); the analyzer graph contract change is additive (`RouteNodeData.input`); graph
geometry, layout parsing and curve round-trips are pure and unit-tested, so the canvas needs only
the browser smoke.

**Superseded in part by D-126:** the layout is no longer a single gitignored `.facilis/graph.json`;
it is a per-element, committable file set under `.facilis/graph/` with markdown notes and AI graph
tools. The interaction rules above (live drag, floating endpoints, editable curves) stand.
