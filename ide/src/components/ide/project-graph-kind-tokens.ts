// Node-kind presentation shared by the palette badges, the minimap rects and the stats ribbon
// (issue #68): one icon, one label key and one fill per kind, so the three surfaces can never
// drift. Role tokens only (D-044) — the minimap fills reuse the SAME semantic roles the canvas
// edge strokes use for the relations each kind owns (project-graph-edges.ts): pages own the
// success page→route stroke, routes the brand fk/page-link strokes, tables the muted route→table
// stroke, views the info route→view stroke, workflows the warning elevated-access role.
// Card sizes are NOT duplicated here: GRAPH_NODE_SIZES (graph-node-size.ts) is the one source
// the LOD footprint, the edge fallback and the minimap fallback share.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { MinimapKind } from "@/facilis/graph-minimap";
import type { MessageKey } from "@/i18n";
import Eye from "~icons/lucide/eye";
import File from "~icons/lucide/file";
import Route from "~icons/lucide/route";
import Table from "~icons/lucide/table";
import Workflow from "~icons/lucide/workflow";

export const GRAPH_NODE_KIND_ICONS: Record<GraphNodeKind, typeof File> = {
  page: File,
  route: Route,
  table: Table,
  view: Eye,
  workflow: Workflow,
};

export const GRAPH_NODE_KIND_LABEL_KEYS: Record<GraphNodeKind, MessageKey> = {
  page: "projectGraph.ribbon.pages",
  route: "projectGraph.ribbon.routes",
  table: "projectGraph.ribbon.tables",
  view: "projectGraph.ribbon.views",
  workflow: "projectGraph.ribbon.workflows",
};

/** The minimap rect fill per kind: semantic role variables, never raw palette values. A
 * cluster frame is a neutral block (its label lives on the canvas, not at minimap scale). */
export const GRAPH_NODE_KIND_FILL: Record<MinimapKind, string> = {
  page: "var(--success)",
  route: "var(--brand)",
  table: "var(--muted-foreground)",
  view: "var(--info)",
  workflow: "var(--warning)",
  cluster: "var(--border)",
};
