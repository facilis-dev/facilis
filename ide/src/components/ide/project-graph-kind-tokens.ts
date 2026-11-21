// Node-kind presentation shared by the palette badges, the minimap rects and the breadcrumbs
// (issue #68): one icon, one label key and one fill per kind. Role tokens only (D-044) — the
// minimap fills reuse the SAME semantic roles the canvas edge strokes use for the relations
// each kind owns (project-graph-edges.ts): pages own the success page→route stroke, routes the
// brand fk/page-link strokes, tables the muted route→table stroke, views the info route→view
// stroke, workflows the warning elevated-access role. No raw palette colours.

import type { GraphNodeKind } from "@facilis.dev/analyze";
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

/** The minimap rect fill per kind: semantic role variables, never raw palette values. */
export const GRAPH_NODE_KIND_FILL: Record<GraphNodeKind, string> = {
  page: "var(--success)",
  route: "var(--brand)",
  table: "var(--muted-foreground)",
  view: "var(--info)",
  workflow: "var(--warning)",
};

/**
 * Card sizes from the Tailwind classes, used before React Flow reports a measurement — the
 * same fallbacks the custom edge uses for its floating anchors, so the minimap and the edge
 * geometry agree on an unmeasured card. A collapsed card is smaller once measured.
 */
export const GRAPH_NODE_FALLBACK_SIZE: Record<
  GraphNodeKind,
  { readonly width: number; readonly height: number }
> = {
  page: { width: 224, height: 157 },
  route: { width: 256, height: 60 },
  table: { width: 240, height: 80 },
  view: { width: 240, height: 80 },
  workflow: { width: 220, height: 48 },
};
