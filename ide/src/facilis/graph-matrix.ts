// The route × schema matrix (issue #67, epic #56): the SAME ProjectGraphView the topology
// canvas draws, pivoted into rows (routes grouped by method) and columns (tables, then a
// separate views block). Pure derivation, no new analysis: every cell is backed by the view's
// own route-table / route-view / view-base edges, so table visibility (D-179), the kind filter
// and the search query are inherited exactly as the topology applies them — hidden tables and
// their edges are already gone upstream, and routes are never filtered (D-179). Pages are not
// matrix material (they call routes, not tables): they are summarised as route counts for the
// header strip. Search keeps every row and dims the unmatched ones, like the topology cards.
//
// Cell kinds stack: a route can declare a table AND reach it through a view, or elevate a
// direct access. "absent" is the empty kind list, not a marker. Elevation travels with the
// route's own hop: a route-table edge, or the route-view edge of a via-view path (the view-base
// hop is declaration metadata, D-097). Degree is matrix-native: the number of non-absent cells
// in a row/column — distinct schema objects a route touches, routes touching a schema object.

import type { HttpMethod } from "@facilis.dev/analyze";
import type {
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectGraphView,
  RouteGraphData,
} from "./graph-types";

/** Row order inside a method group; "path" is the default, so the URL omits it. */
export type GraphMatrixSort = "path" | "degree";
export const GRAPH_MATRIX_SORTS: readonly GraphMatrixSort[] = ["path", "degree"];

export type GraphMatrixCellKind = "declared" | "elevated" | "via-view";
/** Canonical marker order, so stacked glyphs render deterministically. */
export const GRAPH_MATRIX_CELL_KINDS: readonly GraphMatrixCellKind[] = [
  "declared",
  "elevated",
  "via-view",
];

export interface GraphMatrixCell {
  /** Empty means absent; otherwise a canonically ordered, deduplicated kind stack. */
  readonly kinds: readonly GraphMatrixCellKind[];
  /** The view edges backing the markers; empty for an absent cell. */
  readonly edgeIds: readonly string[];
  /** Route, column and any intermediate views — what a topology focus should frame. */
  readonly pathNodeIds: readonly string[];
}

export interface GraphMatrixRow {
  readonly routeId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly label: string;
  /** False when the search query excludes the route; the row is drawn dimmed, never removed. */
  readonly matched: boolean;
  /** Non-absent cells: the distinct schema columns this route touches. */
  readonly degree: number;
  /** Aligned with GraphMatrixModel.columns. */
  readonly cells: readonly GraphMatrixCell[];
}

export interface GraphMatrixGroup {
  readonly method: HttpMethod;
  readonly rows: readonly GraphMatrixRow[];
}

export interface GraphMatrixColumn {
  readonly nodeId: string;
  readonly label: string;
  readonly block: "tables" | "views";
  readonly matched: boolean;
  /** Non-absent cells: the routes touching this schema object. */
  readonly degree: number;
}

export interface GraphMatrixPageSummary {
  readonly pageId: string;
  readonly label: string;
  /** Distinct routes this page calls (page-route edges), for the header strip. */
  readonly routeCount: number;
  readonly matched: boolean;
}

export interface GraphMatrixModel {
  readonly groups: readonly GraphMatrixGroup[];
  /** Tables first (label order), then the views block (label order). */
  readonly columns: readonly GraphMatrixColumn[];
  /** Flattened rows in group order — the cursor and the row window index into this list. */
  readonly rows: readonly GraphMatrixRow[];
  readonly pages: readonly GraphMatrixPageSummary[];
}

/** Canonical method order for the groups; only methods present in the view get a group. */
const METHOD_ORDER: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "ALL",
];

const ABSENT_CELL: GraphMatrixCell = { kinds: [], edgeIds: [], pathNodeIds: [] };

function byLabel(a: { label: string; id: string }, b: { label: string; id: string }): number {
  return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

/** route → table → edges, for the direct (declared/elevated) markers. */
function directEdges(view: ProjectGraphView): Map<string, Map<string, ProjectGraphEdge[]>> {
  const out = new Map<string, Map<string, ProjectGraphEdge[]>>();
  for (const edge of view.edges) {
    if (edge.kind !== "route-table") continue;
    const byTable = out.get(edge.source) ?? new Map<string, ProjectGraphEdge[]>();
    byTable.set(edge.target, [...(byTable.get(edge.target) ?? []), edge]);
    out.set(edge.source, byTable);
  }
  return out;
}

function cellOf(
  kinds: ReadonlySet<GraphMatrixCellKind>,
  edgeIds: ReadonlySet<string>,
  pathNodeIds: ReadonlySet<string>,
): GraphMatrixCell {
  if (kinds.size === 0) return ABSENT_CELL;
  return {
    kinds: GRAPH_MATRIX_CELL_KINDS.filter((kind) => kinds.has(kind)),
    edgeIds: [...edgeIds],
    pathNodeIds: [...pathNodeIds],
  };
}

export function buildGraphMatrix(
  view: ProjectGraphView,
  sort: GraphMatrixSort = "path",
): GraphMatrixModel {
  const routes = view.nodes.filter(
    (node): node is ProjectGraphNode & { readonly data: RouteGraphData } =>
      node.kind === "route" && node.data.kind === "route",
  );
  const tables = view.nodes
    .filter((node) => node.kind === "table")
    .toSorted((a, b) => byLabel(a, b));
  const views = view.nodes.filter((node) => node.kind === "view").toSorted((a, b) => byLabel(a, b));
  const columns: GraphMatrixColumn[] = [
    ...tables.map((node) => ({
      nodeId: node.id,
      label: node.label,
      block: "tables" as const,
      matched: node.matched,
      degree: 0,
    })),
    ...views.map((node) => ({
      nodeId: node.id,
      label: node.label,
      block: "views" as const,
      matched: node.matched,
      degree: 0,
    })),
  ];

  const direct = directEdges(view);
  const routeViews = new Map<string, ProjectGraphEdge[]>();
  const viewBases = new Map<string, Map<string, ProjectGraphEdge[]>>();
  for (const edge of view.edges) {
    if (edge.kind === "route-view") {
      routeViews.set(edge.source, [...(routeViews.get(edge.source) ?? []), edge]);
    } else if (edge.kind === "view-base") {
      const byTable = viewBases.get(edge.source) ?? new Map<string, ProjectGraphEdge[]>();
      byTable.set(edge.target, [...(byTable.get(edge.target) ?? []), edge]);
      viewBases.set(edge.source, byTable);
    }
  }

  const rows: GraphMatrixRow[] = routes.map((route) => {
    const data = route.data;
    const cells: GraphMatrixCell[] = columns.map((column) => {
      const kinds = new Set<GraphMatrixCellKind>();
      const edgeIds = new Set<string>();
      const pathNodeIds = new Set<string>([route.id, column.nodeId]);
      if (column.block === "views") {
        // A view column cell is the declaration itself: the route names the view in dbTables.
        for (const edge of routeViews.get(route.id) ?? []) {
          if (edge.target !== column.nodeId) continue;
          kinds.add("declared");
          if (edge.access === "elevated") kinds.add("elevated");
          edgeIds.add(edge.id);
        }
        return cellOf(kinds, edgeIds, pathNodeIds);
      }
      for (const edge of direct.get(route.id)?.get(column.nodeId) ?? []) {
        kinds.add("declared");
        if (edge.access === "elevated") kinds.add("elevated");
        edgeIds.add(edge.id);
      }
      // Via-view: route → view → base table. The route-view hop carries any elevation.
      for (const edge of routeViews.get(route.id) ?? []) {
        const bases = viewBases.get(edge.target);
        const baseEdges = bases?.get(column.nodeId) ?? [];
        if (baseEdges.length === 0) continue;
        kinds.add("via-view");
        if (edge.access === "elevated") kinds.add("elevated");
        edgeIds.add(edge.id);
        pathNodeIds.add(edge.target);
        for (const base of baseEdges) edgeIds.add(base.id);
      }
      return cellOf(kinds, edgeIds, pathNodeIds);
    });
    const degree = cells.filter((cell) => cell.kinds.length > 0).length;
    return {
      routeId: route.id,
      method: data.method,
      path: data.path,
      label: route.label,
      matched: route.matched,
      degree,
      cells,
    };
  });

  // Column degrees count the same non-absent cells the row degrees count, so the two totals
  // always agree — the matrix's own consistency check against the topology's edge set.
  const degreeByColumn = columns.map((_, index) =>
    rows.reduce((total, row) => total + ((row.cells[index]?.kinds.length ?? 0) > 0 ? 1 : 0), 0),
  );
  const withDegrees = columns.map((column, index) => ({
    ...column,
    degree: degreeByColumn[index] ?? 0,
  }));

  const compare = (a: GraphMatrixRow, b: GraphMatrixRow): number =>
    sort === "degree"
      ? b.degree - a.degree || a.path.localeCompare(b.path) || a.routeId.localeCompare(b.routeId)
      : a.path.localeCompare(b.path) || a.routeId.localeCompare(b.routeId);
  const groups: GraphMatrixGroup[] = METHOD_ORDER.flatMap((method) => {
    const members = rows.filter((row) => row.method === method).toSorted(compare);
    return members.length === 0 ? [] : [{ method, rows: members }];
  });

  const pageRouteTargets = new Map<string, Set<string>>();
  for (const edge of view.edges) {
    if (edge.kind !== "page-route") continue;
    const targets = pageRouteTargets.get(edge.source) ?? new Set<string>();
    targets.add(edge.target);
    pageRouteTargets.set(edge.source, targets);
  }
  const pages: GraphMatrixPageSummary[] = view.nodes
    .filter((node) => node.kind === "page")
    .toSorted((a, b) => byLabel(a, b))
    .map((node) => ({
      pageId: node.id,
      label: node.label,
      routeCount: pageRouteTargets.get(node.id)?.size ?? 0,
      matched: node.matched,
    }));

  return { groups, columns: withDegrees, rows: groups.flatMap((group) => group.rows), pages };
}
