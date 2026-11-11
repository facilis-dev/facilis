// The project graph's saved state (AST graph contract §7, D-126). The state is split across
// small files under `.facilis/graph` so version control works: `layout.json` holds the view
// settings, `nodes.jsonl` one line per position, `edges.jsonl` one line per manual bend and
// `notes/<uuid>.md` one markdown file per annotation. Moving a node on one branch and moving
// another node on another branch are different lines (or files) and merge automatically; only
// the same element conflicts, and then on one visible line.
//
// This module is the pure half: the schema, the v1/v2 migration parser and the immutable
// mutations. graph-layout-files.ts decodes/encodes the files, graph-layout.ts does the IO, and
// `@/facilis/graph-layout` stays the single import path for the UI.
//
// Pan/zoom lives in `viewport.json` and is deliberately git-ignored: it is per machine, not
// team state.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS, type GraphCurve, type GraphNote } from "./graph-types";

export const GRAPH_LAYOUT_VERSION = 3 as const;
/** The debounce the panel uses before writing the state files. */
export const GRAPH_LAYOUT_SAVE_DELAY_MS = 600;

export const GRAPH_DIR = ".facilis/graph";
export const GRAPH_LAYOUT_PATH = GRAPH_DIR + "/layout.json";
/** One small position file per analysis node or note (D-126: one element, one file). */
export const GRAPH_POSITIONS_DIR = GRAPH_DIR + "/positions";
/** One small bend file per manually curved edge. */
export const GRAPH_BENDS_DIR = GRAPH_DIR + "/bends";
export const GRAPH_NOTES_DIR = GRAPH_DIR + "/notes";
export const GRAPH_VIEWPORT_PATH = GRAPH_DIR + "/viewport.json";
/** The single-file state written by the first shipped panel (v1/v2), migrated on read. */
export const GRAPH_LEGACY_PATH = ".facilis/graph.json";

export interface GraphPosition {
  readonly x: number;
  readonly y: number;
}

export interface GraphViewport extends GraphPosition {
  readonly zoom: number;
}

export interface GraphLayoutFile {
  readonly version: typeof GRAPH_LAYOUT_VERSION;
  readonly nodes: Readonly<Record<string, GraphPosition>>;
  readonly hiddenEdges: readonly GraphEdgeKind[];
  /** View preferences (D-163): hide the framework's own routes / unused framework tables. */
  readonly hideSystemRoutes: boolean;
  readonly hideSystemTables: boolean;
  readonly collapsed: Readonly<Record<string, boolean>>;
  /** Manual edge bends, keyed by edge id; a missing id means the automatic path. */
  readonly edgeCurves: Readonly<Record<string, GraphCurve>>;
  /** Markdown annotations, keyed by `note:<uuid>`; the body is one file per note. */
  readonly notes: Readonly<Record<string, GraphNote>>;
  /** Per machine, written to the git-ignored viewport file. */
  readonly viewport?: GraphViewport;
}

export type GraphLayoutSource = "missing" | "ok" | "invalid";

export interface ParsedGraphLayout {
  readonly layout: GraphLayoutFile;
  readonly source: GraphLayoutSource;
}

export interface GraphLayoutMergeInput {
  /** The ids the current analysis reports; everything else is stale. */
  readonly nodeIds: ReadonlySet<string>;
  /** Edge kinds the graph can produce. Defaults to every known kind. */
  readonly edgeKinds?: readonly GraphEdgeKind[];
}

/** An empty layout: the automatic positions, curves and every edge shown. */
export function emptyGraphLayout(): GraphLayoutFile {
  return {
    version: GRAPH_LAYOUT_VERSION,
    nodes: {},
    hiddenEdges: [],
    hideSystemRoutes: false,
    hideSystemTables: false,
    collapsed: {},
    edgeCurves: {},
    notes: {},
  };
}

/** Two decimals: a committed position should not churn on sub-pixel zoom noise. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function readPosition(value: unknown): GraphPosition | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

export function readViewport(value: unknown): GraphViewport | null {
  if (!isRecord(value)) return null;
  const { x, y, zoom } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return null;
  return { x, y, zoom };
}

export function readEdgeKinds(value: unknown): GraphEdgeKind[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(GRAPH_EDGE_KINDS);
  const kinds: GraphEdgeKind[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !known.has(entry)) continue;
    const kind = entry as GraphEdgeKind;
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return GRAPH_EDGE_KINDS.filter((kind) => kinds.includes(kind));
}

export function readCollapsed(value: unknown): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {};
  if (!isRecord(value)) return collapsed;
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") collapsed[id] = entry;
  }
  return collapsed;
}

export function readCurves(value: unknown): Record<string, GraphCurve> {
  const curves: Record<string, GraphCurve> = {};
  if (!isRecord(value)) return curves;
  for (const [id, entry] of Object.entries(value)) {
    const curve = readPosition(entry);
    if (curve !== null) curves[id] = curve;
  }
  return curves;
}

/**
 * Parse the migrated single-file format (v1/v2). Kept as the migration entry point: a project
 * whose `.facilis/graph/` directory is still absent falls back to `.facilis/graph.json`, and
 * the next save rewrites it as the v3 files.
 */
export function parseGraphLayout(text: string | null | undefined): ParsedGraphLayout {
  if (text === null || text === undefined || text.trim() === "") {
    return { layout: emptyGraphLayout(), source: "missing" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { layout: emptyGraphLayout(), source: "invalid" };
  }
  if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2)) {
    return { layout: emptyGraphLayout(), source: "invalid" };
  }
  const positions: Record<string, GraphPosition> = {};
  if (isRecord(raw.nodes)) {
    for (const [id, entry] of Object.entries(raw.nodes)) {
      const position = readPosition(entry);
      if (position !== null) positions[id] = position;
    }
  }
  const viewport = readViewport(raw.viewport);
  return {
    layout: {
      version: GRAPH_LAYOUT_VERSION,
      nodes: positions,
      hiddenEdges: readEdgeKinds(raw.hiddenEdges),
      // The legacy single-file format predates the system filters: show everything (D-163).
      hideSystemRoutes: false,
      hideSystemTables: false,
      collapsed: readCollapsed(raw.collapsed),
      edgeCurves: readCurves(raw.edgeCurves),
      notes: {},
      ...(viewport === null ? {} : { viewport }),
    },
    source: "ok",
  };
}

/** Drop stale ids/edge kinds so a removed node cannot pin a position for a future one. */
export function mergeGraphLayout(
  layout: GraphLayoutFile,
  known: GraphLayoutMergeInput,
): GraphLayoutFile {
  const nodes: Record<string, GraphPosition> = {};
  for (const [id, position] of Object.entries(layout.nodes)) {
    if (known.nodeIds.has(id)) nodes[id] = { x: position.x, y: position.y };
  }
  const collapsed: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(layout.collapsed)) {
    if (known.nodeIds.has(id)) collapsed[id] = value;
  }
  const edgeKinds = new Set<GraphEdgeKind>(known.edgeKinds ?? GRAPH_EDGE_KINDS);
  return {
    version: GRAPH_LAYOUT_VERSION,
    nodes,
    hiddenEdges: layout.hiddenEdges.filter((kind) => edgeKinds.has(kind)),
    hideSystemRoutes: layout.hideSystemRoutes,
    hideSystemTables: layout.hideSystemTables,
    collapsed,
    // Edge ids are not node ids: stale curves are dropped by pruneGraphCurves when the panel
    // next sees the graph, so merge just carries the map along.
    edgeCurves: layout.edgeCurves,
    notes: layout.notes,
    ...(layout.viewport === undefined ? {} : { viewport: layout.viewport }),
  };
}

/**
 * Drop curves whose edge the current graph no longer contains. Returns the same layout
 * instance when nothing was stale: the panel runs this after every view change (including
 * pan/zoom), so a fresh object here would re-render in a loop.
 */
export function pruneGraphCurves(
  layout: GraphLayoutFile,
  edgeIds: ReadonlySet<string>,
): GraphLayoutFile {
  const ids = Object.keys(layout.edgeCurves);
  if (ids.every((id) => edgeIds.has(id))) return layout;
  const edgeCurves: Record<string, GraphCurve> = {};
  for (const id of ids) {
    const curve = layout.edgeCurves[id];
    if (edgeIds.has(id) && curve !== undefined) edgeCurves[id] = curve;
  }
  return { ...layout, edgeCurves };
}

/**
 * "Reset layout": forget every manual position, bend and collapse, and return to the automatic
 * layout. The edge-kind filters are a view preference, not geometry, so they survive; notes are
 * content, not geometry, so they survive too.
 */
export function resetGraphLayoutPositions(layout: GraphLayoutFile): GraphLayoutFile {
  return {
    version: GRAPH_LAYOUT_VERSION,
    nodes: {},
    hiddenEdges: layout.hiddenEdges,
    hideSystemRoutes: layout.hideSystemRoutes,
    hideSystemTables: layout.hideSystemTables,
    collapsed: {},
    edgeCurves: {},
    notes: layout.notes,
  };
}

export const GRAPH_NOTE_PREFIX = "note:";
const NOTE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A note id is `note:<uuid>`: the prefix keeps it out of the analysis node namespace. */
export function isNoteId(id: string): boolean {
  return id.startsWith(GRAPH_NOTE_PREFIX);
}

/** The uuid doubles as the markdown file name, so it must be filename-safe. */
export function isNoteUuid(value: string): boolean {
  return NOTE_UUID.test(value);
}

/** Stable key order for the serialisers: independent elements must be independent lines. */
export function sortedEntries<T>(
  record: Readonly<Record<string, T>>,
): readonly (readonly [string, T])[] {
  const out: (readonly [string, T])[] = [];
  for (const id of Object.keys(record).toSorted()) {
    const value = record[id];
    if (value !== undefined) out.push([id, value] as const);
  }
  return out;
}
