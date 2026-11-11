// Node builders for the project graph, split from graph.ts to keep both files under the
// 300-line source limit. Each builder maps one analyzer fact to its GraphNode shape.
import type {
  GraphNode,
  PageFact,
  PageNodeData,
  RouteFact,
  RouteNodeData,
  ScreenFacts,
  TableFact,
  TableNodeData,
  WorkflowFact,
  WorkflowNodeData,
} from "./types.ts";

const NODE_PREFIX = {
  page: "page:",
  route: "route:",
  table: "table:",
  workflow: "workflow:",
} as const;

export function tableId(name: string): string {
  return NODE_PREFIX.table + name;
}

export function routeId(route: RouteFact): string {
  return NODE_PREFIX.route + route.method + " " + route.path;
}

export function pageId(path: string): string {
  return NODE_PREFIX.page + path;
}

export function workflowId(name: string): string {
  return NODE_PREFIX.workflow + name;
}

export function workflowNode(workflow: WorkflowFact, id: string): GraphNode {
  const data: WorkflowNodeData = {
    kind: "workflow",
    name: workflow.name,
    steps: workflow.steps.map((step) => ({
      index: step.index,
      kind: step.kind,
      name: step.name,
      permission: step.permission,
      onRejectStep: step.onRejectStep,
    })),
    unknown: workflow.unknown.length > 0 || workflow.steps.some((step) => step.name === null),
  };
  return {
    id,
    kind: "workflow",
    label: workflow.name,
    sourceFile: workflow.sourceFile,
    data,
  };
}

export function tableNode(table: TableFact): GraphNode {
  const data: TableNodeData = {
    kind: "table",
    table: table.name,
    columns: table.columns,
    rlsEnabled: table.rlsEnabled,
    scope: table.scope,
    framework: table.source.file.startsWith("node_modules/"),
    unknown:
      table.unknown.length > 0 ||
      table.columns.some((column) => column.unknown.length > 0) ||
      table.policies.some((policy) => policy.unknown.length > 0),
  };
  return {
    id: tableId(table.name),
    kind: "table",
    label: table.name,
    sourceFile: table.source.file,
    data,
  };
}

export function routeNode(route: RouteFact, id: string): GraphNode {
  const data: RouteNodeData = {
    kind: "route",
    method: route.method,
    path: route.path,
    permission: route.permission ?? [],
    wrapper: route.wrapper,
    input: route.input,
    dbTables: route.dbTables ?? [],
    dbColumns: route.dbColumns ?? [],
    elevations: route.elevations,
    description: route.description,
    unknown:
      route.unknown.length > 0 ||
      route.wrapper === "unknown" ||
      route.permission === null ||
      route.dbTables === null,
  };
  return {
    id,
    kind: "route",
    label: route.method + " " + route.path,
    sourceFile: route.sourceFile,
    data,
  };
}

export function pageNode(page: PageFact, id: string, screens: ScreenFacts): GraphNode {
  const preview = screens.previews[page.path];
  const data: PageNodeData = {
    kind: "page",
    pagePath: page.path,
    pageKind: page.kind,
    callCount: page.calls.length,
    ...(preview === undefined ? {} : { routePaths: preview.routePaths, preview }),
  };
  return {
    id,
    kind: "page",
    label: page.path,
    sourceFile: page.path,
    data,
  };
}
