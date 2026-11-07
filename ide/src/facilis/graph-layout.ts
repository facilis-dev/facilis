// The project graph's saved layout (AST graph contract §7): `.facilis/graph.json` holds the
// node positions, hidden edge kinds, collapsed tables and the viewport. It is local editor
// state, never project source — only ids the analyzer still reports are applied (stale ids are
// ignored, new nodes get the automatic layout) — and the file lives under `.facilis`, which
// the runtime keeps gitignored (D-052).
//
// Parsing and serialising are pure so the panel can debounce; the two helpers at the bottom
// are the only IO and go through the kernel bridge's VFS commands (never OPFS, never the AI
// patch path).

import type { GraphEdgeKind } from "@facilis/analyze";
import type { IdeController } from "@/vv/controller";
import { GRAPH_EDGE_KINDS } from "./graph-types";

export { GRAPH_EDGE_KINDS };

export const GRAPH_LAYOUT_VERSION = 1 as const;
export const GRAPH_LAYOUT_DIR = ".facilis";
export const GRAPH_LAYOUT_FILE = "graph.json";
export const GRAPH_LAYOUT_PATH = GRAPH_LAYOUT_DIR + "/" + GRAPH_LAYOUT_FILE;
/** The debounce the panel uses before writing the file. */
export const GRAPH_LAYOUT_SAVE_DELAY_MS = 600;

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
  readonly collapsed: Readonly<Record<string, boolean>>;
  readonly viewport?: GraphViewport;
}

export type GraphLayoutSource = "missing" | "ok" | "invalid";

export interface ParsedGraphLayout {
  readonly layout: GraphLayoutFile;
  readonly source: GraphLayoutSource;
}

/** An empty layout: the automatic positions and every edge shown. */
export function emptyGraphLayout(): GraphLayoutFile {
  return { version: GRAPH_LAYOUT_VERSION, nodes: {}, hiddenEdges: [], collapsed: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readPosition(value: unknown): GraphPosition | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function readViewport(value: unknown): GraphViewport | null {
  if (!isRecord(value)) return null;
  const { x, y, zoom } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return null;
  return { x, y, zoom };
}

function readEdgeKinds(value: unknown): GraphEdgeKind[] {
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

function readPositions(value: unknown): Record<string, GraphPosition> {
  const positions: Record<string, GraphPosition> = {};
  if (!isRecord(value)) return positions;
  for (const [id, entry] of Object.entries(value)) {
    const position = readPosition(entry);
    if (position !== null) positions[id] = position;
  }
  return positions;
}

function readCollapsed(value: unknown): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {};
  if (!isRecord(value)) return collapsed;
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry === "boolean") collapsed[id] = entry;
  }
  return collapsed;
}

/**
 * Parse the file. A missing/blank file is not an error (the user has simply never moved a
 * node); anything present but malformed is reported as `invalid` so the panel can say so
 * and fall back to the automatic layout.
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
  if (!isRecord(raw) || raw.version !== GRAPH_LAYOUT_VERSION) {
    return { layout: emptyGraphLayout(), source: "invalid" };
  }
  const viewport = readViewport(raw.viewport);
  return {
    layout: {
      version: GRAPH_LAYOUT_VERSION,
      nodes: readPositions(raw.nodes),
      hiddenEdges: readEdgeKinds(raw.hiddenEdges),
      collapsed: readCollapsed(raw.collapsed),
      ...(viewport === null ? {} : { viewport }),
    },
    source: "ok",
  };
}

export interface GraphLayoutMergeInput {
  /** The ids the current analysis reports; everything else is stale. */
  readonly nodeIds: ReadonlySet<string>;
  /** Edge kinds the graph can produce. Defaults to every known kind. */
  readonly edgeKinds?: readonly GraphEdgeKind[];
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
    collapsed,
    ...(layout.viewport === undefined ? {} : { viewport: layout.viewport }),
  };
}

function sortedRecord<T>(
  record: Readonly<Record<string, T>>,
  map: (value: T) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(record).toSorted()) {
    const value = record[id];
    if (value !== undefined) out[id] = map(value);
  }
  return out;
}

/** Stable bytes: sorted ids, canonical edge order, and a trailing newline. */
export function serializeGraphLayout(layout: GraphLayoutFile): string {
  const out: Record<string, unknown> = {
    version: GRAPH_LAYOUT_VERSION,
    nodes: sortedRecord(layout.nodes, (position) => ({ x: position.x, y: position.y })),
    hiddenEdges: GRAPH_EDGE_KINDS.filter((kind) => layout.hiddenEdges.includes(kind)),
    collapsed: sortedRecord(layout.collapsed, (value) => value),
  };
  const viewport = layout.viewport;
  if (viewport !== undefined) {
    out.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  }
  return JSON.stringify(out, null, 2) + "\n";
}

export function withNodePosition(
  layout: GraphLayoutFile,
  id: string,
  position: GraphPosition,
): GraphLayoutFile {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return layout;
  return {
    ...layout,
    nodes: { ...layout.nodes, [id]: { x: position.x, y: position.y } },
  };
}

export function withHiddenEdgeKind(
  layout: GraphLayoutFile,
  kind: GraphEdgeKind,
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
  return { ...layout, collapsed: { ...layout.collapsed, [id]: collapsed } };
}

export function withViewport(layout: GraphLayoutFile, viewport: GraphViewport): GraphLayoutFile {
  if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) return layout;
  return { ...layout, viewport };
}

/** "Reset layout": forget every manual position and return to the automatic layout. */
export function resetGraphLayoutPositions(layout: GraphLayoutFile): GraphLayoutFile {
  return {
    version: GRAPH_LAYOUT_VERSION,
    nodes: {},
    hiddenEdges: layout.hiddenEdges,
    collapsed: {},
  };
}

export function graphLayoutPath(root: string): string {
  return root + "/" + GRAPH_LAYOUT_PATH;
}

export type GraphLayoutLoad = {
  readonly layout: GraphLayoutFile;
  readonly source: GraphLayoutSource;
};

/** Read the project's saved layout. A missing or unreadable file is not an error. */
export async function loadGraphLayout(
  controller: IdeController,
  root: string,
): Promise<GraphLayoutLoad> {
  let text = "";
  try {
    text = await controller.readFileText(graphLayoutPath(root));
  } catch {
    return { layout: emptyGraphLayout(), source: "missing" };
  }
  const parsed = parseGraphLayout(text);
  return { layout: parsed.layout, source: parsed.source };
}

// The runtime writes `.facilis/.gitignore` (D-052) when the project first runs; a project
// whose graph is opened before its first run has no such file, so the layout writer makes
// sure one exists instead of leaving the file visible to git.
async function ensureGitIgnored(controller: IdeController, dir: string): Promise<void> {
  const ignorePath = dir + "/.gitignore";
  try {
    const info = await controller.pathInfo(ignorePath);
    if (info.exists) return;
  } catch {
    /* fall through: writing the ignore file is cheap and idempotent */
  }
  await controller.bridge.request("vv-write", { path: ignorePath, contents: "*\n" });
}

/** Write the layout through the kernel VFS. Throws with the kernel's code on failure. */
export async function saveGraphLayout(
  controller: IdeController,
  root: string,
  layout: GraphLayoutFile,
): Promise<void> {
  const dir = root + "/" + GRAPH_LAYOUT_DIR;
  await controller.bridge.request("vv-mkdirp", { path: dir });
  await ensureGitIgnored(controller, dir);
  const reply = await controller.bridge.request("vv-write", {
    path: graphLayoutPath(root),
    contents: serializeGraphLayout(layout),
  });
  if (reply.ok !== true) {
    throw new Error(typeof reply.error === "string" ? reply.error : "vv-write failed");
  }
}
