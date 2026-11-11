// The project graph's edges (D-092, views since D-160), split from graph.ts so both files stay
// under the 300-line source limit. Every edge points at a node the same analysis produced: the
// caller passes the node ids and an edge whose endpoint is missing is dropped, because a
// declaration that names a relation the project does not declare is not a graph fact.
import type { GraphEdge, RouteFact, TableFact } from "./types.ts";
import type { GraphInput } from "./graph.ts";
import { pageId, routeId, tableId, viewId } from "./graph-ids.ts";

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

function elevatedTables(route: RouteFact): ReadonlySet<string> {
  const tables = new Set<string>();
  for (const elevation of route.elevations) {
    for (const table of elevation.tables) tables.add(table);
  }
  return tables;
}

export function collectEdges(input: GraphInput, nodeIds: ReadonlySet<string>): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  const tablesByName = buildTableLookupMap(input.tables);
  // Tables and views share the SQL namespace, so a relation name is at most one of the two.
  const viewNames = new Set(input.views.map((view) => view.name));
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

  // A view depends on the base tables its declaration names (metadata only, D-097). The target
  // is a view when a view declares another view as its base, so the edge lands on the node that
  // exists rather than on a phantom table.
  for (const view of input.views) {
    const source = viewId(view.name);
    for (const base of view.tables) {
      if (base === view.name) continue;
      add({
        id: "view-base:" + view.name + ":" + base,
        kind: "view-base",
        source,
        target: viewNames.has(base) ? viewId(base) : tableId(base),
        label: null,
      });
    }
  }

  for (const route of input.routes) {
    const routeNodeId = routeId(route);
    const elevated = elevatedTables(route);
    // A route declares every relation it touches in dbTables (D-157), tables and views alike:
    // the target kind is decided by the relation the name denotes.
    for (const name of route.dbTables ?? []) {
      const isView = viewNames.has(name);
      add({
        id: (isView ? "route-view:" : "route-table:") + routeNodeId + ":dbTables:" + name,
        kind: isView ? "route-view" : "route-table",
        source: routeNodeId,
        target: isView ? viewId(name) : tableId(name),
        label: "dbTables",
        ...(elevated.has(name) ? { access: "elevated" as const } : {}),
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
        ...(elevated.has(tableName) ? { access: "elevated" as const } : {}),
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

  for (const link of input.screens?.links ?? []) {
    add({
      id: "page-link:" + link.from + ":" + link.to + ":" + link.kind + ":" + link.toPath,
      kind: "page-link",
      source: pageId(link.from),
      target: pageId(link.to),
      label: link.toPath,
    });
  }

  return [...edges.values()];
}
