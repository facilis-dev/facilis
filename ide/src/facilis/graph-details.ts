// Join the analyzer's fact model to the project graph's node ids.
//
// The drawn graph carries only the summary a node card needs, while the inspector wants the
// facts behind it (security flags, columns, policies, foreign keys, page calls, source lines).
// The panel already holds the Analysis, so this pure module joins it to the one id spelling the
// graph uses (D-092) instead of re-reading or re-analyzing anything. A fact that is missing
// simply produces no entry: the inspector then shows the compact node summary.

import {
  pageId,
  routeId,
  tableId,
  viewId,
  workflowId,
  type Analysis,
  type SourceRef,
} from "@facilis.dev/analyze";

export interface RouteDetails {
  readonly source: SourceRef | null;
  readonly dbColumns: readonly string[];
  readonly crossSite: boolean | null;
  readonly rawSql: boolean | null;
  readonly handlerBodyRead: boolean;
  readonly handlerFormRead: boolean;
  readonly relations: {
    readonly used: readonly { name: string; source: SourceRef }[];
    readonly unresolved: number;
    readonly rawSql: number;
    readonly opaque: boolean;
  };
  readonly elevations: readonly {
    kind: "sudo" | "system";
    operation: string | null;
    tables: readonly string[];
    source: SourceRef;
  }[];
}

export interface ColumnDetails {
  readonly property: string;
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly default: { kind: string; value: string | null } | null;
  readonly source: SourceRef;
}

export interface TableDetails {
  readonly source: SourceRef | null;
  readonly columns: readonly ColumnDetails[];
  readonly policies: readonly { name: string; command: string; restrictive: boolean }[];
  readonly foreignKeys: readonly {
    columns: readonly string[];
    targetTable: string;
    targetColumns: readonly string[];
    onDelete: string | null;
    onUpdate: string | null;
  }[];
  readonly relations: readonly {
    from: string;
    to: string;
    cardinality: "one" | "many";
    fields: readonly string[];
    references: readonly string[];
  }[];
}

export interface PageDetails {
  readonly source: SourceRef | null;
  readonly calls: readonly {
    expression: string;
    matchedRouteIds: readonly string[];
    source: SourceRef;
  }[];
}

export interface ViewDetails {
  readonly source: SourceRef | null;
}

export interface WorkflowDetails {
  readonly source: SourceRef | null;
  readonly tables: readonly string[];
  readonly unknownJobs: readonly string[];
  /** True when a referenced job's dbTables is unreadable, so the surface is incomplete. */
  readonly unknown: boolean;
}

export type NodeDetails =
  | { kind: "route"; route: RouteDetails }
  | { kind: "table"; table: TableDetails }
  | { kind: "page"; page: PageDetails }
  | { kind: "view"; view: ViewDetails }
  | { kind: "workflow"; workflow: WorkflowDetails };

/** A table's relations are the facts naming it on either side. */
function relationsOf(name: string, relations: Analysis["relations"]): TableDetails["relations"] {
  return relations
    .filter((relation) => relation.from === name || relation.to === name)
    .map((relation) => ({
      from: relation.from,
      to: relation.to,
      cardinality: relation.cardinality,
      fields: relation.fields,
      references: relation.references,
    }));
}

function routeDetails(analysis: Analysis): ReadonlyMap<string, NodeDetails> {
  const details = new Map<string, NodeDetails>();
  for (const route of analysis.routes) {
    details.set(routeId(route), {
      kind: "route",
      route: {
        source: route.source,
        // null means unknown, not "none": the inspector still needs the empty list shape.
        dbColumns: route.dbColumns ?? [],
        crossSite: route.crossSite,
        rawSql: route.rawSql,
        handlerBodyRead: route.handlerBodyRead,
        handlerFormRead: route.handlerFormRead,
        relations: {
          used: route.relations.used.map((use) => ({ name: use.name, source: use.source })),
          unresolved: route.relations.unresolved.length,
          rawSql: route.relations.rawSql.length,
          opaque: route.relations.opaque,
        },
        elevations: route.elevations.map((elevation) => ({
          kind: elevation.kind,
          operation: elevation.operation,
          tables: elevation.tables,
          source: elevation.source,
        })),
      },
    });
  }
  return details;
}

function tableDetails(analysis: Analysis): ReadonlyMap<string, NodeDetails> {
  const details = new Map<string, NodeDetails>();
  for (const table of analysis.tables) {
    details.set(tableId(table.name), {
      kind: "table",
      table: {
        source: table.source,
        columns: table.columns.map((column) => ({
          property: column.property,
          name: column.name,
          type: column.type,
          notNull: column.notNull,
          primaryKey: column.primaryKey,
          unique: column.unique,
          default:
            column.default === null
              ? null
              : { kind: column.default.kind, value: column.default.value },
          source: column.source,
        })),
        policies: table.policies.map((policy) => ({
          name: policy.name,
          command: policy.command,
          restrictive: policy.restrictive,
        })),
        foreignKeys: table.foreignKeys.map((foreignKey) => ({
          columns: foreignKey.columns,
          targetTable: foreignKey.targetTable,
          targetColumns: foreignKey.targetColumns,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
        })),
        relations: relationsOf(table.name, analysis.relations),
      },
    });
  }
  return details;
}

/** The rest of the per-node facts: pages, views and the workflow table surface. */
function pageViewWorkflowDetails(analysis: Analysis): ReadonlyMap<string, NodeDetails> {
  const details = new Map<string, NodeDetails>();
  for (const page of analysis.pages) {
    // Only real pages are graph nodes; components and lib files stay analyzer-only facts.
    if (page.kind !== "page") continue;
    details.set(pageId(page.path), {
      kind: "page",
      page: {
        source: page.source,
        calls: page.calls.map((call) => ({
          expression: call.expression,
          matchedRouteIds: call.matchedRouteIds,
          source: call.source,
        })),
      },
    });
  }
  for (const view of analysis.views) {
    details.set(viewId(view.name), { kind: "view", view: { source: view.source } });
  }
  const surfaces = new Map(analysis.workflowTables.map((surface) => [surface.name, surface]));
  for (const workflow of analysis.workflows) {
    const surface = surfaces.get(workflow.name);
    details.set(workflowId(workflow.name), {
      kind: "workflow",
      workflow: {
        source: workflow.source,
        tables: surface?.tables ?? [],
        unknownJobs: surface?.unknownJobs ?? [],
        unknown: surface?.unknown === true,
      },
    });
  }
  return details;
}

/** Every node id that has inspectable facts, mapped to them. */
export function buildGraphDetails(analysis: Analysis): ReadonlyMap<string, NodeDetails> {
  const details = new Map<string, NodeDetails>();
  for (const [id, entry] of routeDetails(analysis)) details.set(id, entry);
  for (const [id, entry] of tableDetails(analysis)) details.set(id, entry);
  for (const [id, entry] of pageViewWorkflowDetails(analysis)) details.set(id, entry);
  return details;
}
