import type {
  GraphNode,
  PageFact,
  PageNodeData,
  ProjectGraph,
  RelationFact,
  RouteFact,
  RouteNodeData,
  ScreenFacts,
  TableFact,
  TableNodeData,
  ViewFact,
  ViewNodeData,
  WorkflowFact,
  WorkflowNodeData,
} from "./types.ts";
import { pageId, routeId, tableId, viewId, workflowId } from "./graph-ids.ts";
import { collectEdges } from "./graph-edges.ts";

export interface GraphInput {
  readonly routes: readonly RouteFact[];
  readonly tables: readonly TableFact[];
  readonly relations: readonly RelationFact[];
  readonly pages: readonly PageFact[];
  /** Declarative views (D-097/D-098): nodes plus view-base edges since D-160. */
  readonly views: readonly ViewFact[];
  /** Route paths, bounded page previews and explicit page links. */
  readonly screens?: ScreenFacts;
  /** Workflow definitions read from `server/workflows/**` (D-135 W3). */
  readonly workflows?: readonly WorkflowFact[];
}

function tableNode(table: TableFact): GraphNode {
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

function viewNode(view: ViewFact): GraphNode {
  const data: ViewNodeData = {
    kind: "view",
    view: view.name,
    tables: view.tables,
    permission: view.permission,
    access: view.access,
    unknown: view.unknown.length > 0 || view.access === null,
  };
  return {
    id: viewId(view.name),
    kind: "view",
    label: view.name,
    sourceFile: view.source.file,
    data,
  };
}

function workflowNode(workflow: WorkflowFact): GraphNode {
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
    id: workflowId(workflow.name),
    kind: "workflow",
    label: workflow.name,
    sourceFile: workflow.sourceFile,
    data,
  };
}

function routeNode(route: RouteFact, id: string): GraphNode {
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

function pageNode(page: PageFact, id: string, screens: ScreenFacts): GraphNode {
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

function collectNodes(input: GraphInput): GraphNode[] {
  const nodes: GraphNode[] = [];
  const tableNames = new Set<string>();
  for (const table of input.tables) {
    if (tableNames.has(table.name)) continue;
    tableNames.add(table.name);
    nodes.push(tableNode(table));
  }
  const viewNames = new Set<string>();
  for (const view of input.views) {
    if (viewNames.has(view.name)) continue;
    viewNames.add(view.name);
    nodes.push(viewNode(view));
  }
  const routeIds = new Set<string>();
  for (const route of input.routes) {
    const id = routeId(route);
    if (routeIds.has(id)) continue;
    routeIds.add(id);
    nodes.push(routeNode(route, id));
  }
  const pageIds = new Set<string>();
  const screens = input.screens ?? { previews: {}, links: [] };
  for (const page of input.pages) {
    // The graph's page nodes are real pages only (the user's "pagine e basta"): components and
    // lib files that happen to call an API stay analyzer facts, not boxes on the canvas.
    if (page.kind !== "page") continue;
    const id = pageId(page.path);
    if (pageIds.has(id)) continue;
    pageIds.add(id);
    nodes.push(pageNode(page, id, screens));
  }
  const workflowIds = new Set<string>();
  for (const workflow of input.workflows ?? []) {
    const id = workflowId(workflow.name);
    if (workflowIds.has(id)) continue;
    workflowIds.add(id);
    nodes.push(workflowNode(workflow));
  }
  return nodes;
}

/** Build the single project graph from facts. Ids and ordering are stable across runs. */
export function buildProjectGraph(input: GraphInput): ProjectGraph {
  const nodes = collectNodes(input);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = collectEdges(input, nodeIds);
  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));
  return { nodes, edges };
}
