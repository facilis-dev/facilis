// Graph-facing fact shapes (the project graph's public model), split from types.ts so the
// base fact model stays under the 300-line source limit. Static screen preview/link facts live
// here too because they are attached to page nodes and page-link edges.

import type {
  ColumnFact,
  ElevationFact,
  HttpMethod,
  PageKind,
  RouteInputFact,
  ScopeFact,
  SourceRef,
  WrapperState,
} from "./types.ts";

export type GraphNodeKind = "page" | "route" | "table";

export interface PageNodeData {
  readonly kind: "page";
  readonly pagePath: string;
  readonly pageKind: PageKind;
  readonly callCount: number;
  /** URL paths from the explicit route table; absent when the page is unrouted. */
  readonly routePaths?: readonly string[];
  /** Static component structure used by the graph's page inspector. */
  readonly preview?: PagePreview;
}

export interface RouteNodeData {
  readonly kind: "route";
  readonly method: HttpMethod;
  readonly path: string;
  readonly permission: readonly string[];
  readonly wrapper: WrapperState;
  /** Presence of the handler's input schemas (body/form/query/params), from the AST. */
  readonly input: RouteInputFact;
  readonly dbTables: readonly string[];
  readonly dbColumns: readonly string[];
  /** Audited sudo/system calls, carried for the graph's elevation badge. */
  readonly elevations?: readonly ElevationFact[];
  /** The wrapper config's one-sentence description, or null when absent (D-129). */
  readonly description: string | null;
  readonly unknown: boolean;
}

export interface TableNodeData {
  readonly kind: "table";
  readonly table: string;
  readonly columns: readonly ColumnFact[];
  readonly rlsEnabled: boolean;
  readonly scope: ScopeFact | null;
  /**
   * True when an installed @facilis package declares the table and the project only
   * re-exports it: its source file lives under `node_modules/`.
   */
  readonly framework: boolean;
  readonly unknown: boolean;
}

export type GraphNodeData = PageNodeData | RouteNodeData | TableNodeData;

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly sourceFile: string | null;
  readonly data: GraphNodeData;
}

export type GraphEdgeKind = "fk" | "relation" | "route-table" | "page-route" | "page-link";

export interface GraphEdge {
  readonly id: string;
  readonly kind: GraphEdgeKind;
  readonly source: string;
  readonly target: string;
  readonly label: string | null;
  /** A route-table edge whose table is reached through audited sudo/system elevation. */
  readonly access?: "elevated";
}

export interface ProjectGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** One node of the bounded static structure preview attached to a page. */
export interface PagePreviewNode {
  readonly id: string;
  readonly parentId: string | null;
  /** Component name as written in the JSX (`TodosPage`, `Page`, `header`). */
  readonly name: string;
  readonly kind: "component" | "intrinsic" | "slot";
  /** Project file that defines the component, when it can be resolved statically. */
  readonly file: string | null;
  readonly source: SourceRef;
  /** True when the node sits under a conditional/map branch. */
  readonly dynamic: boolean;
}

/** Static component structure of one page, capped by the analyzer. */
export interface PagePreview {
  /** URL paths resolved from the explicit route table. */
  readonly routePaths: readonly string[];
  readonly nodes: readonly PagePreviewNode[];
  /** True when the maximum depth/node budget cut the structure. */
  readonly truncated: boolean;
}

/** An explicit client-side navigation target (`Link`, `NavLink`, `navigate()`). */
export interface PageLink {
  /** Page file that renders the link. */
  readonly from: string;
  /** Target page file, resolved through the route table. */
  readonly to: string;
  /** URL path written in the source, for the edge label. */
  readonly toPath: string;
  readonly kind: "link" | "navlink" | "navigate";
  readonly source: SourceRef;
}

/** Static screen facts consumed by the graph builder (not a separate analysis output). */
export interface ScreenFacts {
  readonly previews: Readonly<Record<string, PagePreview>>;
  readonly links: readonly PageLink[];
}
