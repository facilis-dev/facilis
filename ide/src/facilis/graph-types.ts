// The project-graph view types: the pure model's public shapes, split from graph-model.ts
// so both files stay under the 300-line source limit. No runtime behaviour lives here.

import type {
  GraphEdgeKind,
  GraphNodeKind,
  HttpMethod,
  PageKind,
  ProjectGraph,
  RouteInputFact,
  WrapperState,
} from "@facilis/analyze";
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
  readonly unknown: boolean;
}

export interface TableGraphData {
  readonly kind: "table";
  readonly table: string;
  readonly columns: readonly GraphColumn[];
  readonly rlsEnabled: boolean;
  /** Declared by an installed @facilis package and only re-exported by the project. */
  readonly framework: boolean;
  readonly scope: GraphScope | null;
  readonly unknown: boolean;
}

export type ProjectGraphNodeData = PageGraphData | RouteGraphData | TableGraphData;

export interface ProjectGraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly sourceFile: string | null;
  readonly position: GraphPosition;
  readonly data: ProjectGraphNodeData;
  /** False when a search query excludes this node (it is drawn dimmed). */
  readonly matched: boolean;
  /** Table columns are hidden when the node was collapsed in an earlier session. */
  readonly collapsed: boolean;
}

export interface ProjectGraphEdge {
  readonly id: string;
  readonly kind: GraphEdgeKind;
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
}

export interface ProjectGraphStats {
  readonly pages: number;
  readonly routes: number;
  readonly tables: number;
  readonly edges: number;
  readonly hiddenEdges: number;
  readonly matches: number;
  readonly unknownNodes: number;
}

export interface ProjectGraphViewInput {
  readonly graph: ProjectGraph;
  /** Saved positions from `.facilis/graph.json`; stale ids are ignored. */
  readonly positions?: Readonly<Record<string, GraphPosition>>;
  /** Edge kinds the layout hides. */
  readonly hiddenEdgeKinds?: readonly GraphEdgeKind[];
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
] as const satisfies readonly GraphEdgeKind[];

/** The three layout columns, in CSS pixels. */
export const GRAPH_COLUMNS = { page: 0, route: 344, table: 680 } as const;
