// Edge presentation shared by the project-graph canvas, its filters and its legend: one
// stroke per edge kind, plus the catalogue key that names it. Role tokens only (D-043/044).
import type { GraphEdgeKind } from "@facilis/analyze";
import type { MessageKey } from "@/i18n";

export interface GraphEdgeStyle {
  readonly stroke: string;
  readonly dashed: boolean;
}

export const GRAPH_EDGE_STYLES: Record<GraphEdgeKind, GraphEdgeStyle> = {
  fk: { stroke: "var(--brand)", dashed: false },
  relation: { stroke: "var(--info)", dashed: true },
  "route-table": { stroke: "var(--muted-foreground)", dashed: false },
  "page-route": { stroke: "var(--success)", dashed: false },
};

export const GRAPH_EDGE_LABEL_KEYS: Record<GraphEdgeKind, MessageKey> = {
  fk: "projectGraph.edge.fk",
  relation: "projectGraph.edge.relation",
  "route-table": "projectGraph.edge.routeTable",
  "page-route": "projectGraph.edge.pageRoute",
};
