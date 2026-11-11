// The project-graph data mappers: the analyzer's GraphNode facts to the canvas model shapes,
// plus the search predicate over them. Split from graph-model.ts so both files stay under the
// 300-line source limit; graph-model.ts keeps the layout and the public build entry point.

import type { ColumnFact, GraphNode, RouteInputFact } from "@facilis/analyze";
import { pathParamsOf } from "./graph-path-params";
import type {
  ColumnMarker,
  GraphColumn,
  PageGraphData,
  ProjectGraphNode,
  RouteGraphData,
  TableGraphData,
  ViewGraphData,
} from "./graph-types";

function columnView(column: ColumnFact): GraphColumn {
  const markers: ColumnMarker[] = [];
  if (column.primaryKey) markers.push("primaryKey");
  if (column.notNull) markers.push("notNull");
  if (column.unique) markers.push("unique");
  if (column.default !== null) markers.push("default");
  if (column.unknown.length > 0) markers.push("unknown");
  return {
    property: column.property,
    name: column.name,
    type: column.type,
    markers,
  };
}

export function pageData(node: GraphNode): PageGraphData | null {
  if (node.data.kind !== "page") return null;
  return {
    kind: "page",
    pagePath: node.data.pagePath,
    pageKind: node.data.pageKind,
    callCount: node.data.callCount,
    routePaths: node.data.routePaths ?? [],
    preview: node.data.preview ?? null,
  };
}

/** An analyzer bundled before the input facts (or a still-running old worker) omits the field. */
const NO_ROUTE_INPUT: RouteInputFact = { body: false, form: false, query: false, params: false };

export function routeData(node: GraphNode): RouteGraphData | null {
  if (node.data.kind !== "route") return null;
  return {
    kind: "route",
    method: node.data.method,
    path: node.data.path,
    permission: node.data.permission,
    wrapper: node.data.wrapper,
    description: node.data.description ?? null,
    input: node.data.input ?? NO_ROUTE_INPUT,
    pathParams: pathParamsOf(node.data.path),
    elevations: node.data.elevations ?? [],
    unknown: node.data.unknown,
  };
}

export function tableData(node: GraphNode): TableGraphData | null {
  if (node.data.kind !== "table") return null;
  return {
    kind: "table",
    table: node.data.table,
    columns: node.data.columns.map(columnView),
    rlsEnabled: node.data.rlsEnabled,
    framework: node.data.framework,
    scope:
      node.data.scope === null
        ? null
        : { column: node.data.scope.column, kind: node.data.scope.kind },
    unknown: node.data.unknown,
  };
}

/** `usedByRoutes` is computed from the edges by buildProjectGraphView, not by the analyzer. */
export function viewData(node: GraphNode): ViewGraphData | null {
  if (node.data.kind !== "view") return null;
  return {
    kind: "view",
    view: node.data.view,
    tables: node.data.tables,
    permission: node.data.permission,
    access: node.data.access,
    unknown: node.data.unknown,
    usedByRoutes: [],
  };
}

export function matchesQuery(node: ProjectGraphNode, needle: string): boolean {
  if (needle.length === 0) return true;
  const values: string[] = [node.label, node.id, node.sourceFile ?? ""];
  const data = node.data;
  if (data.kind === "page") {
    values.push(data.pagePath, data.pageKind, ...data.routePaths);
  } else if (data.kind === "route") {
    values.push(data.method, data.path, data.wrapper, ...data.permission);
    for (const elevation of data.elevations) {
      values.push(elevation.kind, ...elevation.tables);
    }
  } else if (data.kind === "table") {
    for (const column of data.columns) values.push(column.property, column.name, column.type);
  } else {
    values.push(data.view, ...data.tables);
    if (data.permission !== null) values.push(data.permission);
    if (data.access !== null) values.push(data.access);
    for (const route of data.usedByRoutes) values.push(route.label);
  }
  return values.some((value) => value.toLowerCase().includes(needle));
}
