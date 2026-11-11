// The project-graph view types: the pure model's public shapes, split from graph-model.ts
// so both files stay under the 300-line source limit. No runtime behaviour lives here.

import type {
  ElevationFact,
  GraphEdgeKind,
  GraphNodeKind,
  HttpMethod,
  PageKind,
  PagePreview,
  ProjectGraph,
  RouteInputFact,
  WrapperState,
} from "@facilis.dev/analyze";
import type { GraphPosition } from "./graph-layout";

/** A per-edge curve offset from the automatic path, in flow coordinates. */
export interface GraphCurve {
  readonly x: number;
  readonly y: number;
}

/** A free-floating markdown annotation on the canvas (D-126). */
export interface GraphNote {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export type ColumnMarker = "primaryKey" | "notNull" | "unique" | "default" | "unknown";

export interface GraphColumn {
  /** Drizzle property key (`dueDate`), the domain dbColumns uses. */
  readonly property: string;
  /** SQL column name (`due_date`). */
  readonly name: string;
  readonly type: string;
  readonly markers: readonly ColumnMarker[];
}

export interface GraphScope {
  readonly column: string;
  readonly kind: "tenant" | "owner";
}

export interface PageGraphData {
  readonly kind: "page";
  readonly pagePath: string;
  readonly pageKind: PageKind;
  readonly callCount: number;
  /** URL paths from the explicit route table. */
  readonly routePaths: readonly string[];
  /** Bounded static component structure for the inspector. */
  readonly preview: PagePreview | null;
}

export interface RouteGraphData {
  readonly kind: "route";
  readonly method: HttpMethod;
  readonly path: string;
  readonly permission: readonly string[];
  readonly wrapper: WrapperState;
  /** The wrapper config's one-sentence description, or null when absent (D-129). */
  readonly description: string | null;
  /** Presence of the handler's input schemas (body/form/query/params). */
  readonly input: RouteInputFact;
  /** Path parameters declared by the route template (`{id}` → `id`). */
  readonly pathParams: readonly string[];
  /** Tables and views the handler declares (D-157); empty when the config could not be read. */
  readonly dbTables: readonly string[];
  /** Audited elevation calls in the handler, for the card badge and tooltip. */
  readonly elevations: readonly ElevationFact[];
  readonly unknown: boolean;
}

export interface WorkflowStepGraphData {
  readonly index: number;
  readonly kind: "job" | "approval";
  /** Job name or approval title key; null when the definition could not be read. */
  readonly name: string | null;
  readonly permission: string | null;
  readonly onRejectStep: number | null;
}

export interface WorkflowGraphData {
  readonly kind: "workflow";
  readonly name: string;
  readonly steps: readonly WorkflowStepGraphData[];
  readonly unknown: boolean;
}

export interface TableGraphData {
  readonly kind: "table";
  readonly table: string;
  readonly columns: readonly GraphColumn[];
  readonly rlsEnabled: boolean;
  /** Declared by an installed @facilis.dev package and only re-exported by the project. */
  readonly framework: boolean;
  readonly scope: GraphScope | null;
  readonly unknown: boolean;
}

/** A route that names this view in its `dbTables` (an incoming route-view edge). */
export interface UsedByRoute {
  readonly id: string;
  readonly label: string;
}

/** A declarative view declared with defineView under db/views (D-097/D-098, D-160). */
export interface ViewGraphData {
  readonly kind: "view";
  /** The view's SQL name: what a route declares in `dbTables` (D-157). */
  readonly view: string;
  /** Base tables named by the declaration (metadata only, D-097). */
  readonly tables: readonly string[];
  /** The view's own permission; null keeps the invoker behaviour (D-098). */
  readonly permission: string | null;
  /** null when a declared permission could not be read, so the mode is unknown. */
  readonly access: "invoker" | "definer" | null;
  readonly unknown: boolean;
  /** Routes whose dbTables name this view, sorted by label; computed from route-view edges. */
  readonly usedByRoutes: readonly UsedByRoute[];
}

export type ProjectGraphNodeData =
  PageGraphData | RouteGraphData | TableGraphData | ViewGraphData | WorkflowGraphData;

/**
 * The node classes the graph's system filters can hide independently (D-163): the framework's
 * own feature surface rather than the project's data surface.
 */
export type GraphSystemNodeKind = "routes" | "tables";

export interface ProjectGraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly sourceFile: string | null;
  readonly position: GraphPosition;
  readonly data: ProjectGraphNodeData;
  /** False when a search query excludes this node (it is drawn dimmed). */
  readonly matched: boolean;
  /** Table columns or view base tables are hidden when the node was collapsed earlier. */
  readonly collapsed: boolean;
}

export interface ProjectGraphEdge {
  readonly id: string;
  readonly kind: GraphEdgeKind;
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
  /** A route-table or route-view edge reached through audited elevation. */
  readonly access?: "elevated";
}

export interface ProjectGraphStats {
  readonly pages: number;
  readonly routes: number;
  readonly tables: number;
  readonly views: number;
  readonly workflows: number;
  readonly edges: number;
  readonly hiddenEdges: number;
  /** Nodes removed by the system filters (0 while both are off, D-163). */
  readonly hiddenNodes: number;
  readonly matches: number;
  readonly unknownNodes: number;
  /** Page → page explicit navigation edges. */
  readonly pageLinks: number;
  /** Route → table edges reached through audited elevation. */
  readonly elevatedEdges: number;
}

export interface ProjectGraphViewInput {
  readonly graph: ProjectGraph;
  /** Saved positions from `.facilis/graph.json`; stale ids are ignored. */
  readonly positions?: Readonly<Record<string, GraphPosition>>;
  /** Edge kinds the layout hides. */
  readonly hiddenEdgeKinds?: readonly GraphEdgeKind[];
  /** Hide routes the project does not declare (the framework's feature surface, D-163). */
  readonly hideSystemRoutes?: boolean;
  /** Hide framework tables that none of the project's own routes uses (D-163). */
  readonly hideSystemTables?: boolean;
  readonly collapsed?: Readonly<Record<string, boolean>>;
  readonly query?: string;
}

export interface ProjectGraphView {
  readonly nodes: readonly ProjectGraphNode[];
  readonly edges: readonly ProjectGraphEdge[];
  readonly stats: ProjectGraphStats;
}

/** Canonical edge-kind order, used by the filters, serialiser and legend. */
export const GRAPH_EDGE_KINDS = [
  "fk",
  "relation",
  "route-table",
  "page-route",
  "page-link",
  // Appended, never inserted: the persisted hiddenEdges list is ordered by this array, so a new
  // kind in the middle would churn every saved layout (and the AI's plan diffs).
  "route-view",
  "view-base",
] as const satisfies readonly GraphEdgeKind[];

/**
 * The layout columns, in CSS pixels. Views are schema objects too, so they share the tables
 * column (below it, behind a gap); workflows get the fourth column on the right.
 */
export const GRAPH_COLUMNS = {
  page: 0,
  route: 344,
  table: 680,
  view: 680,
  workflow: 1016,
} as const;
