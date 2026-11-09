// The project graph's saved state: the immutable mutations plus the public re-exports
// (AST graph contract §7, D-126).
//
// The state lives in `.facilis/graph/` as one small file per element — graph-layout-files.ts
// owns the encoding, graph-layout-io.ts the kernel VFS calls — so `@/facilis/graph-layout` stays
// the single import path for the UI. One element per file is what makes a normal git merge
// automatic: two branches moving different nodes never conflict, and the same node conflicts on
// one readable file.
//
// A project written before D-126 has a single `.facilis/graph.json`; it is read once and
// rewritten as the v3 files on the next save.

import {
  GRAPH_NOTE_PREFIX,
  type GraphLayoutFile,
  type GraphPosition,
  type GraphViewport,
} from "./graph-layout-file";
import { GRAPH_EDGE_KINDS, type GraphCurve, type GraphNote } from "./graph-types";

export { GRAPH_EDGE_KINDS, type GraphCurve, type GraphNote } from "./graph-types";
export {
  GRAPH_DIR,
  GRAPH_LAYOUT_PATH,
  GRAPH_LAYOUT_SAVE_DELAY_MS,
  GRAPH_LAYOUT_VERSION,
  GRAPH_NOTES_DIR,
  GRAPH_NOTE_PREFIX,
  GRAPH_POSITIONS_DIR,
  emptyGraphLayout,
  isNoteId,
  mergeGraphLayout,
  parseGraphLayout,
  pruneGraphCurves,
  resetGraphLayoutPositions,
  type GraphLayoutFile,
  type GraphLayoutSource,
  type GraphPosition,
  type GraphViewport,
  type ParsedGraphLayout,
} from "./graph-layout-file";
export {
  bendPath,
  decodeGraphLayout,
  elementFileName,
  elementPath,
  encodeGraphLayout,
  noteFilePath,
} from "./graph-layout-files";
export { loadGraphLayout, saveGraphLayout, type GraphLayoutLoad } from "./graph-layout-io";

/** Near-zero bend means "back on the automatic path": the entry is dropped, not stored. */
const CURVE_RESET_DISTANCE = 0.5;

export function withNodePosition(
  layout: GraphLayoutFile,
  id: string,
  position: GraphPosition,
): GraphLayoutFile {
  const current = layout.nodes[id];
  if (current !== undefined && current.x === position.x && current.y === position.y) return layout;
  return {
    ...layout,
    nodes: { ...layout.nodes, [id]: { x: position.x, y: position.y } },
  };
}

export function withHiddenEdgeKind(
  layout: GraphLayoutFile,
  kind: GraphLayoutFile["hiddenEdges"][number],
  hidden: boolean,
): GraphLayoutFile {
  const next = new Set(layout.hiddenEdges);
  if (hidden) next.add(kind);
  else next.delete(kind);
  return {
    ...layout,
    hiddenEdges: GRAPH_EDGE_KINDS.filter((entry) => next.has(entry)),
  };
}

export function withCollapsed(
  layout: GraphLayoutFile,
  id: string,
  collapsed: boolean,
): GraphLayoutFile {
  if (layout.collapsed[id] === collapsed) return layout;
  return { ...layout, collapsed: { ...layout.collapsed, [id]: collapsed } };
}

export function withViewport(layout: GraphLayoutFile, viewport: GraphViewport): GraphLayoutFile {
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return layout;
  return { ...layout, viewport };
}

/**
 * Set, move or clear one edge's manual curve. `null`, a non-finite offset or a near-zero
 * offset (the user dragged it back onto the automatic path) clears the entry. Identity is
 * preserved whenever the result is unchanged, so a no-op commit cannot trigger a render.
 */
export function withEdgeCurve(
  layout: GraphLayoutFile,
  edgeId: string,
  curve: GraphCurve | null,
): GraphLayoutFile {
  const current = layout.edgeCurves[edgeId];
  const clears =
    curve === null ||
    !Number.isFinite(curve.x) ||
    !Number.isFinite(curve.y) ||
    (Math.abs(curve.x) < CURVE_RESET_DISTANCE && Math.abs(curve.y) < CURVE_RESET_DISTANCE);
  if (clears) {
    if (current === undefined) return layout;
    return { ...layout, edgeCurves: withoutCurve(layout.edgeCurves, edgeId) };
  }
  if (current !== undefined && current.x === curve.x && current.y === curve.y) return layout;
  return { ...layout, edgeCurves: { ...layout.edgeCurves, [edgeId]: { x: curve.x, y: curve.y } } };
}

function withoutCurve(
  curves: Readonly<Record<string, GraphCurve>>,
  edgeId: string,
): Record<string, GraphCurve> {
  const next: Record<string, GraphCurve> = {};
  for (const [id, curve] of Object.entries(curves)) {
    if (id !== edgeId) next[id] = curve;
  }
  return next;
}

/** `note:<uuid>`: the uuid is the on-disk markdown file name. */
export function newNoteId(): string {
  return GRAPH_NOTE_PREFIX + crypto.randomUUID();
}

export function addGraphNote(layout: GraphLayoutFile, note: GraphNote): GraphLayoutFile {
  return { ...layout, notes: { ...layout.notes, [note.id]: note } };
}

export function withNoteText(layout: GraphLayoutFile, id: string, text: string): GraphLayoutFile {
  const current = layout.notes[id];
  if (current === undefined || current.text === text) return layout;
  return { ...layout, notes: { ...layout.notes, [id]: { ...current, text } } };
}

export function withNotePosition(
  layout: GraphLayoutFile,
  id: string,
  position: GraphPosition,
): GraphLayoutFile {
  const current = layout.notes[id];
  if (current === undefined) return layout;
  if (current.x === position.x && current.y === position.y) return layout;
  return {
    ...layout,
    notes: { ...layout.notes, [id]: { ...current, x: position.x, y: position.y } },
  };
}

export function withoutGraphNote(layout: GraphLayoutFile, id: string): GraphLayoutFile {
  if (layout.notes[id] === undefined) return layout;
  const notes: Record<string, GraphNote> = {};
  for (const [entryId, note] of Object.entries(layout.notes)) {
    if (entryId !== id) notes[entryId] = note;
  }
  return { ...layout, notes };
}
