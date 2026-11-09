import type {
  GraphEdge,
  GraphNode,
  PageFact,
  PageNodeData,
  ProjectGraph,
  RelationFact,
  RouteFact,
  RouteNodeData,
  TableFact,
  TableNodeData,
} from "./types.ts";

export interface GraphInput {
  readonly routes: readonly RouteFact[];
  readonly tables: readonly TableFact[];
  readonly relations: readonly RelationFact[];
  readonly pages: readonly PageFact[];
}

const NODE_PREFIX = { page: "page:", route: "route:", table: "table:" } as const;

function tableId(name: string): string {
  return NODE_PREFIX.table + name;
}

function routeId(route: RouteFact): string {
  return NODE_PREFIX.route + route.method + " " + route.path;
}

function pageId(path: string): string {
  return NODE_PREFIX.page + path;
}

function tableNode(table: TableFact): GraphNode {
  const data: TableNodeData = {
    kind: "table",
    table: table.name,
    columns: table.columns,
    rlsEnabled: table.rlsEnabled,
    scope: table.scope,
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

function pageNode(page: PageFact, id: string): GraphNode {
  const data: PageNodeData = {
    kind: "page",
    pagePath: page.path,
    pageKind: page.kind,
    callCount: page.calls.length,
  };
  return {
    id,
    kind: "page",
    label: page.path,
    sourceFile: page.path,
    data,
  };
}

function fkLabel(
  table: TableFact,
  targetTable: string,
  targetColumns: readonly string[],
  onDelete: string | null,
): string {
  let label = table.name + " -> " + targetTable + "." + targetColumns.join(", ");
  if (onDelete !== null) label += " on delete " + onDelete;
  return label;
}

function relationLabel(cardinality: "one" | "many"): string {
  return cardinality;
}

function buildTableLookupMap(tables: readonly TableFact[]): Map<string, TableFact> {
  const byName = new Map<string, TableFact>();
  for (const table of tables) {
    if (!byName.has(table.name)) byName.set(table.name, table);
  }
  return byName;
}

function collectNodes(input: GraphInput): GraphNode[] {
  const nodes: GraphNode[] = [];
  const tableNames = new Set<string>();
  for (const table of input.tables) {
    if (tableNames.has(table.name)) continue;
    tableNames.add(table.name);
    nodes.push(tableNode(table));
  }
  const routeIds = new Set<string>();
  for (const route of input.routes) {
    const id = routeId(route);
    if (routeIds.has(id)) continue;
    routeIds.add(id);
    nodes.push(routeNode(route, id));
  }
  const pageIds = new Set<string>();
  for (const page of input.pages) {
    // Only client files that actually call a route are graph nodes; scanning every
    // component would bury the API flow under files with no edges.
    if (page.calls.length === 0) continue;
    const id = pageId(page.path);
    if (pageIds.has(id)) continue;
    pageIds.add(id);
    nodes.push(pageNode(page, id));
  }
  return nodes;
}

function collectEdges(input: GraphInput, nodeIds: ReadonlySet<string>): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  const tablesByName = buildTableLookupMap(input.tables);
  const add = (edge: GraphEdge): void => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    if (edges.has(edge.id)) return;
    edges.set(edge.id, edge);
  };

  for (const table of input.tables) {
    for (const foreignKey of table.foreignKeys) {
      add({
        id:
          "fk:" +
          table.name +
          ":" +
          foreignKey.columns.join(",") +
          ":" +
          foreignKey.targetTable +
          ":" +
          foreignKey.targetColumns.join(","),
        kind: "fk",
        source: tableId(table.name),
        target: tableId(foreignKey.targetTable),
        label: fkLabel(
          table,
          foreignKey.targetTable,
          foreignKey.targetColumns,
          foreignKey.onDelete,
        ),
      });
    }
  }

  for (const relation of input.relations) {
    const id = ["relation", relation.from, relation.to, relation.cardinality];
    if (relation.fields.length > 0) id.push(relation.fields.join(","));
    if (relation.references.length > 0) id.push(relation.references.join(","));
    add({
      id: id.join(":"),
      kind: "relation",
      source: tableId(relation.from),
      target: tableId(relation.to),
      label: relationLabel(relation.cardinality),
    });
  }

  for (const route of input.routes) {
    const routeNodeId = routeId(route);
    for (const tableName of route.dbTables ?? []) {
      add({
        id: "route-table:" + routeNodeId + ":dbTables:" + tableName,
        kind: "route-table",
        source: routeNodeId,
        target: tableId(tableName),
        label: "dbTables",
      });
    }
    for (const entry of route.dbColumns ?? []) {
      const separator = entry.indexOf(".");
      if (separator <= 0) continue;
      const tableName = entry.slice(0, separator);
      const columnName = entry.slice(separator + 1);
      const table = tablesByName.get(tableName);
      const knownColumn = table?.columns.some((column) => column.property === columnName);
      if (knownColumn !== true) continue;
      add({
        id: "route-table:" + routeNodeId + ":dbColumns:" + tableName,
        kind: "route-table",
        source: routeNodeId,
        target: tableId(tableName),
        label: "dbColumns",
      });
    }
  }

  for (const page of input.pages) {
    const source = pageId(page.path);
    for (const call of page.calls) {
      for (const matchedRouteId of call.matchedRouteIds) {
        add({
          id: "page-route:" + page.path + ":" + matchedRouteId,
          kind: "page-route",
          source,
          target: matchedRouteId,
          label: null,
        });
      }
    }
  }

  return [...edges.values()];
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
