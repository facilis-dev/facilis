// The project graph's addressable view state (issue #58, epic #56 rule 6): one compact URL
// parameter carries the whole view — mode, lenses, edge/node isolation, selection, user focus,
// filters, collapsed clusters, viewport and query — so a tab can be reloaded or shared and land
// on the same view.
//
// Pure by design: no React, no IO, no URL globals. graph-view-state-url.ts merges the encoded
// value into the tab URL and useProjectGraphViewState.ts owns the lifecycle. The layout file
// (.facilis/graph, v3) stays a document (positions, curves, notes); nothing here writes it.
//
// The AI focus (D-171, graph-focus.ts) is deliberately NOT part of this state: it is a
// transient overlay composed on top, never persisted and never in the URL.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import {
  isFiniteNumber,
  isRecord,
  readEdgeKinds,
  roundCoordinate,
  type GraphViewport,
} from "./graph-layout-file";
import { GRAPH_EDGE_KINDS, type GraphTableVisibility } from "./graph-types";
import { DEFAULT_RUNTIME_WINDOW, RUNTIME_WINDOW_IDS, type RuntimeWindow } from "./graph-runtime";

/** How the graph is drawn. Matrix and timeline are later children (#67/#76): carried, not rendered. */
export type GraphViewMode = "topology" | "matrix" | "timeline";

/**
 * The epic's meaning-layer lenses. Ids only for now: the lens UIs land in later children of
 * #56, and a lens changes colour/badges/dimming, never positions (epic rule 2). Timeline is a
 * MODE, not a lens. Order matters: the first active lens is the dominant one (epic rule 3).
 */
export const GRAPH_LENS_IDS = ["contract", "data", "runtime", "agent", "impact", "roles"] as const;
export type GraphLensId = (typeof GRAPH_LENS_IDS)[number];

export interface GraphViewFilters {
  readonly hiddenEdgeKinds: readonly GraphEdgeKind[];
  readonly tableVisibility: GraphTableVisibility;
}

/**
 * The group-by mode switch (issue #62, F.4): "auto" enables clusters above the node threshold,
 * "on"/"off" are the user's explicit choice. Only the explicit choices travel in the URL.
 * Clustering is a layout MODE, not a lens: it re-lays auto positions, never saved ones.
 */
export type GraphGroupBy = "auto" | "on" | "off";

export interface GraphViewState {
  readonly mode: GraphViewMode;
  readonly activeLenses: readonly GraphLensId[];
  /** Edge kinds isolated by the canvas chips (issue #63): opacity only, never a removal. */
  readonly isolatedEdgeKinds: readonly GraphEdgeKind[];
  /** The runtime lens's selected window (issue #72); carried even while the lens is off. */
  readonly runtimeWindow: RuntimeWindow;
  /** The runtime lens's live toggle (issue #72): off reads the last snapshot. */
  readonly runtimeLive: boolean;
  /**
   * Node isolation (issue #66): the dim-only focus mode around this node's reachability
   * closure (F.5). Like edge isolation it is opacity only — non-closure cards recede to 12%,
   * nothing is removed — and a one-step Esc exits it. Null draws the full graph undimmed.
   */
  readonly isolatedNode: string | null;
  readonly selection: string | null;
  /** USER focus ids — distinct from the AI focus overlay, which is never URL state. */
  readonly focus: readonly string[];
  readonly filters: GraphViewFilters;
  readonly collapsed: readonly string[];
  /** Cluster collapse (issue #62): view state only, never written to .facilis/graph/. */
  readonly collapsedClusters: readonly string[];
  readonly groupBy: GraphGroupBy;
  /** The drilled-into cluster id (breadcrumb); Esc goes up one level. */
  readonly drill: string | null;
  readonly viewport: GraphViewport | null;
  readonly query: string;
}

/** Matches emptyGraphLayout's view defaults: topology, no lenses, everything shown. */
export const DEFAULT_GRAPH_VIEW_STATE: GraphViewState = {
  mode: "topology",
  activeLenses: [],
  isolatedEdgeKinds: [],
  runtimeWindow: DEFAULT_RUNTIME_WINDOW,
  runtimeLive: false,
  isolatedNode: null,
  selection: null,
  focus: [],
  filters: { hiddenEdgeKinds: [], tableVisibility: "all" },
  collapsed: [],
  collapsedClusters: [],
  groupBy: "auto",
  drill: null,
  viewport: null,
  query: "",
};

const MODES: readonly GraphViewMode[] = ["topology", "matrix", "timeline"];
const VISIBILITIES: readonly GraphTableVisibility[] = ["project", "used", "all"];
const LENS_SET = new Set<string>(GRAPH_LENS_IDS);
/** Hostile or corrupt payloads degrade to defaults instead of parsing without bound. */
const MAX_RAW_LENGTH = 4096;

/** Zoom keeps three decimals: it is a ratio, not a pixel coordinate (two would visibly snap). */
function roundZoom(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Deduplicate non-empty strings, keeping first-occurrence order so round-trips are stable. */
function uniqueStrings(value: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * Compact JSON, short keys, defaults and empties omitted; the viewport is a rounded
 * [x, y, zoom] triple. The default view encodes to "" — the parameter is absent until the
 * user changes something, so an untouched tab keeps a clean URL.
 */
export function encodeGraphViewState(state: GraphViewState): string {
  const out: Record<string, unknown> = {};
  if (state.mode !== "topology") out.m = state.mode;
  const lenses = uniqueStrings(state.activeLenses);
  if (lenses.length > 0) out.l = lenses;
  const isolatedSet = new Set(state.isolatedEdgeKinds);
  const isolated = GRAPH_EDGE_KINDS.filter((kind) => isolatedSet.has(kind));
  if (isolated.length > 0) out.i = isolated;
  // Runtime lens options (issue #72): two short keys, omitted at their defaults so an
  // untouched lens keeps the URL clean. "rw"/"rl" avoid #69's audit-filter key "a".
  if (state.runtimeWindow !== DEFAULT_RUNTIME_WINDOW) out.rw = state.runtimeWindow;
  if (state.runtimeLive) out.rl = true;
  if (state.isolatedNode !== null && state.isolatedNode !== "") out.n = state.isolatedNode;
  if (state.selection !== null && state.selection !== "") out.s = state.selection;
  const focus = uniqueStrings(state.focus);
  if (focus.length > 0) out.f = focus;
  // Canonical edge-kind order on both sides: decode(encode(s)) is stable for any input order.
  const hidden = new Set(state.filters.hiddenEdgeKinds);
  const kinds = GRAPH_EDGE_KINDS.filter((kind) => hidden.has(kind));
  if (kinds.length > 0) out.h = kinds;
  if (state.filters.tableVisibility !== "all") out.t = state.filters.tableVisibility;
  const collapsed = uniqueStrings(state.collapsed);
  if (collapsed.length > 0) out.c = collapsed;
  const collapsedClusters = uniqueStrings(state.collapsedClusters);
  if (collapsedClusters.length > 0) out.cc = collapsedClusters;
  if (state.groupBy !== "auto") out.g = state.groupBy;
  if (state.drill !== null && state.drill !== "") out.d = state.drill;
  const viewport = state.viewport;
  if (viewport !== null) {
    out.v = [roundCoordinate(viewport.x), roundCoordinate(viewport.y), roundZoom(viewport.zoom)];
  }
  if (state.query !== "") out.q = state.query;
  return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}

function readMode(value: unknown): GraphViewMode {
  return MODES.find((mode) => mode === value) ?? "topology";
}

function readGroupBy(value: unknown): GraphGroupBy {
  return value === "on" || value === "off" ? value : "auto";
}

function readVisibility(value: unknown): GraphTableVisibility {
  return VISIBILITIES.find((visibility) => visibility === value) ?? "all";
}

function readLenses(value: unknown): GraphLensId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: GraphLensId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !LENS_SET.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry as GraphLensId);
  }
  return out;
}

function readRuntimeWindow(value: unknown): RuntimeWindow {
  return RUNTIME_WINDOW_IDS.find((window) => window === value) ?? DEFAULT_RUNTIME_WINDOW;
}

function readIds(value: unknown, knownNodeIds?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry === "" || seen.has(entry)) continue;
    if (knownNodeIds !== undefined && !knownNodeIds.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function readSelection(value: unknown, knownNodeIds?: ReadonlySet<string>): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (knownNodeIds !== undefined && !knownNodeIds.has(value)) return null;
  return value;
}

function readEncodedViewport(value: unknown): GraphViewport | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, zoom] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return null;
  const rounded = { x: roundCoordinate(x), y: roundCoordinate(y), zoom: roundZoom(zoom) };
  // Rounding can overflow a hostile 1e308 to Infinity; such a viewport is not a view.
  if (!isFiniteNumber(rounded.x) || !isFiniteNumber(rounded.y) || !isFiniteNumber(rounded.zoom)) {
    return null;
  }
  return rounded;
}

/**
 * Total function: null, malformed JSON, wrong types and oversized payloads degrade to the
 * default view, never throw. Unknown lens ids are dropped against the registry; when
 * knownNodeIds is provided, selection/isolatedNode/focus/collapsed ids missing from it are
 * dropped too (stale ids from another project or an older analysis).
 */
export function decodeGraphViewState(
  raw: string | null,
  knownNodeIds?: ReadonlySet<string>,
): GraphViewState {
  if (raw === null || raw === "" || raw.length > MAX_RAW_LENGTH) return DEFAULT_GRAPH_VIEW_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_GRAPH_VIEW_STATE;
  }
  if (!isRecord(parsed)) return DEFAULT_GRAPH_VIEW_STATE;
  return {
    mode: readMode(parsed.m),
    activeLenses: readLenses(parsed.l),
    isolatedEdgeKinds: readEdgeKinds(parsed.i),
    runtimeWindow: readRuntimeWindow(parsed.rw),
    runtimeLive: parsed.rl === true,
    isolatedNode: readSelection(parsed.n, knownNodeIds),
    selection: readSelection(parsed.s, knownNodeIds),
    focus: readIds(parsed.f, knownNodeIds),
    filters: {
      hiddenEdgeKinds: readEdgeKinds(parsed.h),
      tableVisibility: readVisibility(parsed.t),
    },
    collapsed: readIds(parsed.c, knownNodeIds),
    // Cluster ids are derived ("cluster:<key>"), not analysis node ids: they cannot be checked
    // against knownNodeIds here; the view drops ids no current cluster carries.
    collapsedClusters: readIds(parsed.cc),
    groupBy: readGroupBy(parsed.g),
    drill: readSelection(parsed.d),
    viewport: readEncodedViewport(parsed.v),
    query: typeof parsed.q === "string" ? parsed.q : "",
  };
}
