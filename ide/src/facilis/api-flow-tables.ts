// Table-side helpers of the API Flow model (D-087): which tables each operation touches
// and the route→table edges. Split from api-flow-model.ts to keep both files under the
// 300-line limit; the public graph types stay in the model module.

import type { ApiOperation } from "./api-flow-client";
import type { ApiFlowEdge } from "./api-flow-model";

export interface TableUsage {
  columns: Set<string>;
  routes: Set<string>;
}

/** Code-unit order: stable across locales and machines, unlike localeCompare. */
export function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function routeNodeId(operation: ApiOperation): string {
  return "route:" + operation.method + " " + operation.path;
}

export function tableNodeId(name: string): string {
  return "table:" + name;
}

function tableOfColumn(column: string): string | null {
  const dot = column.indexOf(".");
  return dot > 0 ? column.slice(0, dot) : null;
}

export function tablesFor(operation: ApiOperation): string[] {
  const tables = new Set(operation.dbTables);
  for (const column of operation.dbColumns) {
    const table = tableOfColumn(column);
    if (table !== null) tables.add(table);
  }
  return [...tables].toSorted(compareStrings);
}

export function collectTableUsage(operations: readonly ApiOperation[]): Map<string, TableUsage> {
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

/** Route→table edges, dashed when only dbColumns names the table (column-level). */
export function collectEdges(operations: readonly ApiOperation[]): ApiFlowEdge[] {
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
