// Maps the analyzer's GraphNode data onto the view model's per-kind shapes (split from
// graph-model.ts for the 300-line gate). Pure data mapping: no layout, no React.
import type { ColumnFact, GraphNode, RouteInputFact } from "@facilis/analyze";
import type {
  ColumnMarker,
  GraphColumn,
  PageGraphData,
  RouteGraphData,
  TableGraphData,
  WorkflowGraphData,
} from "./graph-types";
import { pathParamsOf } from "./graph-path-params";

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

export function workflowData(node: GraphNode): WorkflowGraphData | null {
  if (node.data.kind !== "workflow") return null;
  return {
    kind: "workflow",
    name: node.data.name,
    steps: node.data.steps.map((step) => ({
      index: step.index,
      kind: step.kind,
      name: step.name,
      permission: step.permission,
      onRejectStep: step.onRejectStep,
    })),
    unknown: node.data.unknown,
  };
}
