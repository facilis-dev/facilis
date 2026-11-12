import { describe, expect, it } from "vitest";
import {
  pageId,
  routeId,
  tableId,
  viewId,
  workflowId,
  type Analysis,
  type ColumnFact,
  type PageFact,
  type RelationFact,
  type RouteFact,
  type RouteRelationsFact,
  type SourceRef,
  type TableFact,
  type ViewFact,
  type WorkflowFact,
  type WorkflowTablesFact,
} from "@facilis.dev/analyze";
import { buildGraphDetails } from "./graph-details";

const ref = (file: string, line: number): SourceRef => ({ file, line });

// The fixtures spell out the fact shapes the analyzer really returns; only the Analysis
// wrapper below is a seam, so a field rename in the fact model breaks these tests.
function routeFact(overrides: Partial<RouteFact> = {}): RouteFact {
  return {
    method: "GET",
    path: "/api/todos",
    sourceFile: "server/routes/todos.get.ts",
    source: ref("server/routes/todos.get.ts", 3),
    wrapper: "valid",
    permission: ["todos:read"],
    crossSite: false,
    dbTables: ["todos"],
    dbColumns: [],
    rawSql: false,
    relations: emptyRelations(),
    description: null,
    input: { body: false, form: false, query: false, params: false },
    handlerBodyRead: false,
    handlerFormRead: false,
    elevations: [],
    unknown: [],
    ...overrides,
  };
}

function emptyRelations(overrides: Partial<RouteRelationsFact> = {}): RouteRelationsFact {
  return { used: [], unresolved: [], rawSql: [], opaque: false, elevations: [], ...overrides };
}

function columnFact(overrides: Partial<ColumnFact> = {}): ColumnFact {
  return {
    property: "id",
    name: "id",
    builder: "uuid",
    type: "uuid",
    notNull: true,
    primaryKey: true,
    unique: false,
    default: null,
    source: ref("db/schema.ts", 2),
    unknown: [],
    ...overrides,
  };
}

function tableFact(overrides: Partial<TableFact> = {}): TableFact {
  return {
    name: "todos",
    binding: "todos",
    columns: [columnFact()],
    primaryKey: ["id"],
    foreignKeys: [],
    policies: [],
    rlsEnabled: true,
    scope: null,
    source: ref("db/schema.ts", 1),
    unknown: [],
    ...overrides,
  };
}

function relationFact(overrides: Partial<RelationFact> = {}): RelationFact {
  return {
    from: "todos",
    to: "projects",
    cardinality: "one",
    fields: ["projectId"],
    references: ["id"],
    source: ref("db/relations.ts", 1),
    unknown: [],
    ...overrides,
  };
}

function viewFact(overrides: Partial<ViewFact> = {}): ViewFact {
  return {
    name: "active_todos",
    binding: "activeTodos",
    tables: ["todos"],
    permission: null,
    access: "invoker",
    source: ref("db/views/active-todos.ts", 1),
    unknown: [],
    ...overrides,
  };
}

function pageFact(overrides: Partial<PageFact> = {}): PageFact {
  return {
    path: "src/pages/todos.tsx",
    kind: "page",
    calls: [],
    source: ref("src/pages/todos.tsx", 1),
    unknown: [],
    ...overrides,
  };
}

function workflowFact(overrides: Partial<WorkflowFact> = {}): WorkflowFact {
  return {
    name: "purge",
    sourceFile: "server/workflows/purge.ts",
    source: ref("server/workflows/purge.ts", 1),
    steps: [],
    unknown: [],
    ...overrides,
  };
}

function workflowTablesFact(overrides: Partial<WorkflowTablesFact> = {}): WorkflowTablesFact {
  return {
    name: "purge",
    sourceFile: "server/workflows/purge.ts",
    source: ref("server/workflows/purge.ts", 1),
    tables: [],
    unknownJobs: [],
    unknown: false,
    ...overrides,
  };
}

interface AnalysisParts {
  readonly routes?: readonly RouteFact[];
  readonly tables?: readonly TableFact[];
  readonly relations?: readonly RelationFact[];
  readonly views?: readonly ViewFact[];
  readonly pages?: readonly PageFact[];
  readonly workflows?: readonly WorkflowFact[];
  readonly workflowTables?: readonly WorkflowTablesFact[];
}

/**
 * The join reads only these seven fact lists, so a test spells the facts it is about and
 * leaves the rest of `Analysis` (config, diagnostics, graph…) out: faking those would add
 * noise without covering anything here. Every fact above is still a fully checked fact type,
 * so the cast cannot hide a field rename in the part under test.
 */
function analysisOf(parts: AnalysisParts): Analysis {
  return {
    routes: [],
    tables: [],
    relations: [],
    views: [],
    pages: [],
    workflows: [],
    workflowTables: [],
    ...parts,
  } as unknown as Analysis;
}

describe("buildGraphDetails", () => {
  it("maps a route to its route node id with the security flags, relations and elevations", () => {
    const route = routeFact({
      method: "POST",
      path: "/api/todos",
      source: ref("server/routes/todos.post.ts", 4),
      crossSite: true,
      rawSql: null,
      dbColumns: null,
      handlerBodyRead: true,
      relations: emptyRelations({
        used: [
          { name: "todos", source: ref("server/routes/todos.post.ts", 9) },
          { name: "active_todos", source: ref("server/routes/todos.post.ts", 12) },
        ],
        unresolved: [ref("server/routes/todos.post.ts", 15)],
        rawSql: [ref("server/routes/todos.post.ts", 18)],
        opaque: true,
      }),
      elevations: [
        {
          kind: "sudo",
          operation: "todos.purge",
          tables: ["todos"],
          source: ref("server/routes/todos.post.ts", 21),
          unknown: [],
        },
      ],
    });
    const details = buildGraphDetails(analysisOf({ routes: [route] }));

    expect(details.get(routeId(route))).toEqual({
      kind: "route",
      route: {
        source: ref("server/routes/todos.post.ts", 4),
        dbColumns: [],
        crossSite: true,
        rawSql: null,
        handlerBodyRead: true,
        handlerFormRead: false,
        relations: {
          used: [
            { name: "todos", source: ref("server/routes/todos.post.ts", 9) },
            { name: "active_todos", source: ref("server/routes/todos.post.ts", 12) },
          ],
          unresolved: 1,
          rawSql: 1,
          opaque: true,
        },
        elevations: [
          {
            kind: "sudo",
            operation: "todos.purge",
            tables: ["todos"],
            source: ref("server/routes/todos.post.ts", 21),
          },
        ],
      },
    });
    expect(details.get("route:POST /api/todos")).toBe(details.get(routeId(route)));
  });

  it("joins table columns, policies and foreign keys", () => {
    const table = tableFact({
      source: ref("db/schema.ts", 5),
      columns: [
        columnFact({ property: "id", name: "id", primaryKey: true, notNull: true }),
        columnFact({
          property: "createdAt",
          name: "created_at",
          builder: "timestamp",
          type: "timestamp",
          primaryKey: false,
          notNull: false,
          unique: true,
          default: { kind: "now", value: null },
          source: ref("db/schema.ts", 7),
        }),
      ],
      policies: [
        {
          name: "todos_read",
          command: "SELECT",
          restrictive: false,
          source: ref("db/policies.ts", 2),
          unknown: [],
        },
        {
          name: "todos_scope",
          command: "ALL",
          restrictive: true,
          source: ref("db/policies.ts", 8),
          unknown: [],
        },
      ],
      foreignKeys: [
        {
          columns: ["projectId"],
          targetTable: "projects",
          targetColumns: ["id"],
          onDelete: "cascade",
          onUpdate: null,
          source: ref("db/schema.ts", 12),
        },
      ],
    });
    const entry = buildGraphDetails(analysisOf({ tables: [table] })).get(tableId("todos"));

    expect(entry?.kind).toBe("table");
    if (entry?.kind !== "table") throw new Error("expected table details");
    expect(entry.table.source).toEqual(ref("db/schema.ts", 5));
    expect(entry.table.columns.map((column) => column.name)).toEqual(["id", "created_at"]);
    expect(entry.table.columns[1]).toEqual({
      property: "createdAt",
      name: "created_at",
      type: "timestamp",
      notNull: false,
      primaryKey: false,
      unique: true,
      default: { kind: "now", value: null },
      source: ref("db/schema.ts", 7),
    });
    expect(entry.table.primaryKey).toEqual(["id"]);
    expect(entry.table.policies[1]).toEqual({
      name: "todos_scope",
      command: "ALL",
      restrictive: true,
    });
    expect(entry.table.foreignKeys[0]?.targetTable).toBe("projects");
    expect(entry.table.foreignKeys[0]?.onUpdate).toBeNull();
  });

  it("matches relations by the from and to table names", () => {
    const todos = tableFact({ name: "todos" });
    const projects = tableFact({ name: "projects", source: ref("db/schema.ts", 20) });
    const unrelated = tableFact({ name: "audit" });
    const details = buildGraphDetails(
      analysisOf({
        tables: [todos, projects, unrelated],
        relations: [
          relationFact(),
          relationFact({
            from: "projects",
            to: "todos",
            cardinality: "many",
            fields: ["id"],
            references: ["projectId"],
          }),
          relationFact({ from: "audit", to: "sessions", fields: [], references: [] }),
        ],
      }),
    );

    const todosEntry = details.get(tableId("todos"));
    const projectsEntry = details.get(tableId("projects"));
    const unrelatedEntry = details.get(tableId("audit"));
    if (
      todosEntry?.kind !== "table" ||
      projectsEntry?.kind !== "table" ||
      unrelatedEntry?.kind !== "table"
    ) {
      throw new Error("expected table details");
    }
    // Both directions name the table, so both show up on it; the third relation names neither.
    expect(todosEntry.table.relations.map((relation) => relation.to)).toEqual([
      "projects",
      "todos",
    ]);
    expect(projectsEntry.table.relations.map((relation) => relation.from)).toEqual([
      "todos",
      "projects",
    ]);
    expect(unrelatedEntry.table.relations.map((relation) => relation.to)).toEqual(["sessions"]);
  });

  it("maps pages, views and workflows to their node ids", () => {
    const route = routeFact();
    const page = pageFact({
      calls: [
        {
          expression: 'api("/api/todos")',
          kind: "literal",
          staticPrefix: "/api/todos",
          matchedRouteIds: [routeId(route)],
          source: ref("src/pages/todos.tsx", 6),
          unknown: [],
        },
      ],
    });
    const component = pageFact({ path: "src/components/button.tsx", kind: "component" });
    const view = viewFact();
    const workflow = workflowFact();
    const surface = workflowTablesFact({
      tables: ["projects", "todos"],
      unknownJobs: ["purge-todos"],
    });
    const details = buildGraphDetails(
      analysisOf({
        routes: [route],
        pages: [page, component],
        views: [view],
        workflows: [workflow],
        workflowTables: [surface],
      }),
    );

    expect(details.get(pageId("src/pages/todos.tsx"))).toEqual({
      kind: "page",
      page: {
        source: ref("src/pages/todos.tsx", 1),
        calls: [
          {
            expression: 'api("/api/todos")',
            kind: "literal",
            matchedRouteIds: [routeId(route)],
            source: ref("src/pages/todos.tsx", 6),
          },
        ],
      },
    });
    // Components are analyzer facts, not page nodes.
    expect(details.has(pageId("src/components/button.tsx"))).toBe(false);
    expect(details.get(viewId("active_todos"))).toEqual({
      kind: "view",
      view: { source: ref("db/views/active-todos.ts", 1) },
    });
    expect(details.get(workflowId("purge"))).toEqual({
      kind: "workflow",
      workflow: {
        source: ref("server/workflows/purge.ts", 1),
        tables: ["projects", "todos"],
        unknownJobs: ["purge-todos"],
      },
    });
  });

  it("gives a workflow with no derived table surface empty lists", () => {
    const details = buildGraphDetails(
      analysisOf({ workflows: [workflowFact({ name: "orphan" })] }),
    );
    expect(details.get(workflowId("orphan"))).toEqual({
      kind: "workflow",
      workflow: { source: ref("server/workflows/purge.ts", 1), tables: [], unknownJobs: [] },
    });
  });

  it("returns no entry for a fact the analysis does not have", () => {
    expect(buildGraphDetails(analysisOf({})).size).toBe(0);
  });
});
