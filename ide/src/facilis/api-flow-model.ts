// The API Flow's pure view model (SPEC §10.2, §12 Phase 3): every OpenAPI operation,
// the tables its `x-db-*` metadata touches, and the edges between them, laid out in
// deterministic columns (one per resource) with the tables to the right. Free of React
// and fetch so the grouping/layout rules stay testable.

import type { ApiFlowData, ApiFlowWarning, ApiMethod, ApiOperation } from "./api-flow-client";

/** Badge/legend order for the per-method counts. */
export const METHOD_ORDER: readonly ApiMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// Layout units. Columns are resources, rows are the routes inside a resource.
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 92;
const TABLE_COLUMN_GAP = 120;
const ROOT_RESOURCE = "root";

/** The data a route node carries; a type alias so it satisfies React Flow's data bound. */
export type RouteNodeData = {
  method: ApiMethod;
  path: string;
  /** First segment after `/api`, or `root` for an ungrouped route. */
  resource: string;
  summary: string | null;
  permission: string[];
  /** Distinct tables the route declares through `x-db-tables`/`x-db-columns`. */
  tableCount: number;
  sourceFile: string | null;
};

/** The data a table node carries. */
export type TableNodeData = {
  name: string;
  columnCount: number;
  routeCount: number;
};

export interface ApiRouteNode {
  id: string;
  data: RouteNodeData;
  position: { x: number; y: number };
}

export interface ApiTableNode {
  id: string;
  data: TableNodeData;
  position: { x: number; y: number };
}

export interface ApiFlowEdge {
  id: string;
  source: string;
  target: string;
  /** True when only `dbColumns` links the pair, i.e. a column-level dependency. */
  dashed: boolean;
}

export interface ApiFlowStats {
  routes: number;
  tables: number;
  edges: number;
  byMethod: Record<ApiMethod, number>;
}

export interface ApiFlowGraph {
  routes: ApiRouteNode[];
  tables: ApiTableNode[];
  edges: ApiFlowEdge[];
  stats: ApiFlowStats;
  warnings: ApiFlowWarning[];
  /** The facade answered 200 with an `openapi-unavailable` warning (SPEC §6.9). */
  openapiUnavailable: boolean;
}

interface TableUsage {
  columns: Set<string>;
  routes: Set<string>;
}

/** Build the panel's graph: routes grouped by resource, tables, edges and counts. */
export function buildApiFlowGraph(data: ApiFlowData): ApiFlowGraph {
  const operations = [...data.operations].toSorted(compareOperations);
  const resources = collectResources(operations);
  const resourceIndex = new Map(resources.map((resource, index) => [resource, index]));
  const rows = new Map<string, number>();

  const routes = operations.map((operation) => {
    const resource = resourceOf(operation.path);
    const row = rows.get(resource) ?? 0;
    rows.set(resource, row + 1);
    return {
      id: routeNodeId(operation),
      data: {
        method: operation.method,
        path: operation.path,
        resource,
        summary: operation.summary,
        permission: operation.permission,
        tableCount: tablesFor(operation).length,
        sourceFile: operation.sourceFile,
      },
      position: { x: (resourceIndex.get(resource) ?? 0) * COLUMN_WIDTH, y: row * ROW_HEIGHT },
    } satisfies ApiRouteNode;
  });

  const usage = collectTableUsage(operations);
  const tableNames = [...usage.keys()].toSorted(compareStrings);
  const tableX = resources.length === 0 ? 0 : resources.length * COLUMN_WIDTH + TABLE_COLUMN_GAP;
  const tables = tableNames.map((name, index) => {
    const entry = usage.get(name);
    return {
      id: tableNodeId(name),
      data: {
        name,
        columnCount: entry?.columns.size ?? 0,
        routeCount: entry?.routes.size ?? 0,
      },
      position: { x: tableX, y: index * ROW_HEIGHT },
    } satisfies ApiTableNode;
  });

  const edges = collectEdges(operations);
  const byMethod: Record<ApiMethod, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
  for (const operation of operations) byMethod[operation.method] += 1;

  return {
    routes,
    tables,
    edges,
    warnings: data.warnings,
    stats: { routes: routes.length, tables: tables.length, edges: edges.length, byMethod },
    openapiUnavailable: data.warnings.some((warning) => warning.code === "openapi-unavailable"),
  };
}

function routeNodeId(operation: ApiOperation): string {
  return "route:" + operation.method + " " + operation.path;
}

function tableNodeId(name: string): string {
  return "table:" + name;
}

function resourceOf(path: string): string {
  const match = /^\/api(?=\/|$)(?:\/([^/]+))?/.exec(path);
  return match?.[1] ?? ROOT_RESOURCE;
}

function tableOfColumn(column: string): string | null {
  const dot = column.indexOf(".");
  return dot > 0 ? column.slice(0, dot) : null;
}

/** Code-unit order: stable across locales and machines, unlike localeCompare. */
function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareResources(left: string, right: string): number {
  if (left === ROOT_RESOURCE) return right === ROOT_RESOURCE ? 0 : -1;
  if (right === ROOT_RESOURCE) return 1;
  return compareStrings(left, right);
}

function compareOperations(left: ApiOperation, right: ApiOperation): number {
  const byResource = compareResources(resourceOf(left.path), resourceOf(right.path));
  if (byResource !== 0) return byResource;
  const byPath = compareStrings(left.path, right.path);
  if (byPath !== 0) return byPath;
  return METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method);
}

function collectResources(operations: readonly ApiOperation[]): string[] {
  const names = new Set(operations.map((operation) => resourceOf(operation.path)));
  return [...names].toSorted(compareResources);
}

function tablesFor(operation: ApiOperation): string[] {
  const tables = new Set(operation.dbTables);
  for (const column of operation.dbColumns) {
    const table = tableOfColumn(column);
    if (table !== null) tables.add(table);
  }
  return [...tables].toSorted(compareStrings);
}

function collectTableUsage(operations: readonly ApiOperation[]): Map<string, TableUsage> {
  const usage = new Map<string, TableUsage>();
  const ensure = (name: string): TableUsage => {
    const existing = usage.get(name);
    if (existing !== undefined) return existing;
    const created: TableUsage = { columns: new Set(), routes: new Set() };
    usage.set(name, created);
    return created;
  };
  for (const operation of operations) {
    const routeId = routeNodeId(operation);
    for (const table of operation.dbTables) ensure(table).routes.add(routeId);
    for (const column of operation.dbColumns) {
      const table = tableOfColumn(column);
      if (table === null) continue;
      const entry = ensure(table);
      entry.routes.add(routeId);
      entry.columns.add(column.slice(table.length + 1));
    }
  }
  return usage;
}

function collectEdges(operations: readonly ApiOperation[]): ApiFlowEdge[] {
  const edges: ApiFlowEdge[] = [];
  const seen = new Set<string>();
  for (const operation of operations) {
    const source = routeNodeId(operation);
    const declared = new Set(operation.dbTables);
    for (const table of tablesFor(operation)) {
      const target = tableNodeId(table);
      const id = "edge:" + source + "->" + target;
      if (seen.has(id)) continue;
      seen.add(id);
      edges.push({ id, source, target, dashed: !declared.has(table) });
    }
  }
  return edges;
}
