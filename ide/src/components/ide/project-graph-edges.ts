// Edge presentation shared by the project-graph canvas, its filters and its legend: one
// stroke per edge kind, plus the catalogue key that names it. Role tokens only (D-043/044).
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import type { MessageKey } from "@/i18n";
import type { ProjectGraphEdge } from "@/facilis/graph-types";

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

export const GRAPH_EDGE_LABEL_KEYS: Record<GraphEdgeKind, MessageKey> = {
  fk: "projectGraph.edge.fk",
  relation: "projectGraph.edge.relation",
  "route-table": "projectGraph.edge.routeTable",
  "page-route": "projectGraph.edge.pageRoute",
  "page-link": "projectGraph.edge.pageLink",
  "route-view": "projectGraph.edge.routeView",
  "view-base": "projectGraph.edge.viewBase",
};
