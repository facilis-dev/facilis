// Edge presentation shared by the project-graph canvas, its filters and its legend: one
// stroke per edge kind. Role tokens only (D-043/044). The catalogue keys and the bridge apex
// text live in graph-edge-labels.ts so the screenshot scene can share them; re-exported here
// for the existing filter/legend call sites.
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { ProjectGraphEdge } from "@/facilis/graph-types";

export { GRAPH_EDGE_LABEL_KEYS } from "@/facilis/graph-edge-labels";

export interface GraphEdgeStyle {
  readonly stroke: string;
  readonly dashed: boolean;
}

export const GRAPH_EDGE_STYLES: Record<GraphEdgeKind, GraphEdgeStyle> = {
  fk: { stroke: "var(--brand)", dashed: false },
  relation: { stroke: "var(--info)", dashed: true },
  "route-table": { stroke: "var(--muted-foreground)", dashed: false },
  "page-route": { stroke: "var(--success)", dashed: false },
  "page-link": { stroke: "var(--brand)", dashed: false },
  "route-view": { stroke: "var(--info)", dashed: true },
  "view-base": { stroke: "var(--muted-foreground)", dashed: true },
};

/** One colour for every audited elevation, whatever the sudo/system mix. */
export const ELEVATED_EDGE_STYLE: GraphEdgeStyle = {
  stroke: "var(--warning)",
  dashed: false,
};

export function edgeStyleFor(edge: Pick<ProjectGraphEdge, "kind" | "access">): GraphEdgeStyle {
  return edge.access === "elevated" ? ELEVATED_EDGE_STYLE : GRAPH_EDGE_STYLES[edge.kind];
}

// ── Data lens (issue #70) ──────────────────────────────────────────────────────────────────
// The schema half of the graph gets stronger, pairwise-distinct strokes: width alone separates
// fk from the dashed kinds, and every dashed kind owns a different dash pattern, so the encoding
// never rests on colour (epic rule 6). Non-schema kinds keep their base presentation under the
// lens; an elevated edge always wins, dotted plus the lock label (criterion 1). The stroke COLOUR
// stays the base one: the flow builder colours the arrowhead from the base style, so the two
// must keep agreeing.

export interface DataEdgeStyle {
  readonly stroke: string;
  /** null is a solid stroke; otherwise the explicit strokeDasharray. */
  readonly dash: string | null;
  readonly width: number;
}

export const DATA_EDGE_STYLES: Record<GraphEdgeKind, DataEdgeStyle> = {
  fk: { stroke: "var(--brand)", dash: null, width: 2.5 },
  relation: { stroke: "var(--info)", dash: "6 3", width: 2.5 },
  "route-table": { stroke: "var(--muted-foreground)", dash: null, width: 1.5 },
  "page-route": { stroke: "var(--success)", dash: null, width: 1.5 },
  "page-link": { stroke: "var(--brand)", dash: null, width: 1.5 },
  "route-view": { stroke: "var(--info)", dash: "8 3 2 3", width: 2.5 },
  "view-base": { stroke: "var(--muted-foreground)", dash: "2 4", width: 2.5 },
};

/** Dotted, not dashed: distinct from every schema dash at every zoom, plus the lock label. */
export const DATA_ELEVATED_STYLE: DataEdgeStyle = {
  stroke: "var(--warning)",
  dash: "1 3",
  width: 2.5,
};

export function dataEdgeStyleFor(edge: Pick<ProjectGraphEdge, "kind" | "access">): DataEdgeStyle {
  return edge.access === "elevated" ? DATA_ELEVATED_STYLE : DATA_EDGE_STYLES[edge.kind];
}

/** Dimmed opacity for bridges while another bridge is hovered/focused (issue #65). */
export const BRIDGE_DIM_OPACITY = 0.25;

// ── Agent turn-diff lens (issue #73) ──────────────────────────────────────────────────────
// The SCM overlay replaces the kind's stroke with a status colour and a distinct dash: changed
// reads warning with a long dash, broken reads muted with a short gap (a visibly severed line).
// Width and dash alone carry the meaning too, so the encoding is never colour-only (rule 6).
// The lens is read-only: these are presentation tokens, nothing here writes git or .facilis.

export interface TurnEdgeStyle {
  readonly stroke: string;
  /** null is a solid stroke; otherwise the explicit strokeDasharray. */
  readonly dash: string | null;
  readonly width: number;
}

export const TURN_EDGE_STYLES: Record<"changed" | "broken", TurnEdgeStyle> = {
  changed: { stroke: "var(--warning)", dash: "7 3", width: 2 },
  broken: { stroke: "var(--muted-foreground)", dash: "2 4", width: 1.5 },
};
