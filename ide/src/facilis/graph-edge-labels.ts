// Edge label text shared by the canvas, the HUD filters and the screenshot scene (issue #65):
// the catalogue key that names each edge kind, and the bridge apex text. The apex shows the
// analyzer's own edge label when there is one (epic #56 rule 5: marks derive from facts) and
// falls back to the translated kind name. One helper for both renderers keeps the canvas and
// graph_screenshot identical for the same input.

import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";

export const GRAPH_EDGE_LABEL_KEYS: Record<GraphEdgeKind, MessageKey> = {
  fk: "projectGraph.edge.fk",
  relation: "projectGraph.edge.relation",
  "route-table": "projectGraph.edge.routeTable",
  "page-route": "projectGraph.edge.pageRoute",
  "page-link": "projectGraph.edge.pageLink",
  "route-view": "projectGraph.edge.routeView",
  "view-base": "projectGraph.edge.viewBase",
};

/** The bridge apex text: the analyzer fact when present, else the kind's catalogue name. */
export function bridgeApexLabel(edge: {
  readonly label: string | null;
  readonly kind: GraphEdgeKind;
}): string {
  return edge.label ?? t(GRAPH_EDGE_LABEL_KEYS[edge.kind]);
}

/** What a screen reader announces for a bridge edge (the apex label is decorative aria-wise). */
export function bridgeAriaLabel(apexLabel: string): string {
  return t("projectGraph.bridge.ariaLabel", { label: apexLabel });
}
