// The diagnostics join (issue #69): one-to-one attribution. Every attachable error/warning lands
// on exactly one node — never duplicated across cards sharing a file — and unattributable
// diagnostics stay out instead of being guessed onto a node.
import { describe, expect, it } from "vitest";
import {
  buildProjectGraph,
  routeId,
  tableId,
  viewId,
  type Analysis,
  type Diagnostic,
  type PageFact,
  type RouteFact,
  type RouteRelationsFact,
  type SourceRef,
  type TableFact,
  type ViewFact,
  type WorkflowFact,
} from "@facilis.dev/analyze";
import { buildNodeDiagnostics, worstSeverity } from "./graph-diagnostics";

const ref = (file: string, line: number): SourceRef => ({ file, line });

function emptyRelations(): RouteRelationsFact {
  return { used: [], unresolved: [], rawSql: [], opaque: false, elevations: [], services: [] };
}

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

function tableFact(overrides: Partial<TableFact> = {}): TableFact {
  return {
    name: "todos",
    binding: "todos",
    columns: [],
    primaryKey: [],
    foreignKeys: [],
    indexes: [],
    checks: [],
    uniqueConstraints: [],
    unsupported: [],
    policies: [],
    rlsEnabled: true,
    scope: null,
    source: ref("db/schema.ts", 1),
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

const pageFact: PageFact = {
  path: "src/pages/todos.tsx",
  kind: "page",
  calls: [],
  source: ref("src/pages/todos.tsx", 1),
  unknown: [],
};

const workflowFact: WorkflowFact = {
  name: "purge",
  sourceFile: "server/workflows/purge.ts",
  source: ref("server/workflows/purge.ts", 1),
  steps: [],
  unknown: [],
};

const diag = (
  severity: Diagnostic["severity"],
  code: string,
  source: SourceRef | null,
): Diagnostic => ({ code, severity, message: code + " message", source });

interface Parts {
  readonly routes?: readonly RouteFact[];
  readonly tables?: readonly TableFact[];
  readonly views?: readonly ViewFact[];
  readonly pages?: readonly PageFact[];
  readonly workflows?: readonly WorkflowFact[];
  readonly diagnostics?: readonly Diagnostic[];
}

/** The join reads the fact lists, the diagnostics and the built graph; the rest is not its input. */
function analysisOf(parts: Parts): Analysis {
  const routes = parts.routes ?? [];
  const tables = parts.tables ?? [];
  const views = parts.views ?? [];
  const pages = parts.pages ?? [];
  const workflows = parts.workflows ?? [];
  return {
    routes,
    tables,
    views,
    pages,
    workflows,
    relations: [],
    diagnostics: parts.diagnostics ?? [],
    graph: buildProjectGraph({ routes, tables, relations: [], pages, views, workflows }),
  } as unknown as Analysis;
}

/** Flatten the join and check the one-to-one property against the source list. */
function attachedList(map: ReadonlyMap<string, readonly Diagnostic[]>): Diagnostic[] {
  return [...map.values()].flat();
}

describe("buildNodeDiagnostics", () => {
  it("attaches a route error to its route node, one-to-one", () => {
    const route = routeFact();
    const error = diag("error", "route-wrapper", ref(route.sourceFile, 3));
    const map = buildNodeDiagnostics(analysisOf({ routes: [route], diagnostics: [error] }));
    expect(map.get(routeId(route))).toEqual([error]);
    expect(attachedList(map)).toEqual([error]);
  });

  it("disambiguates tables sharing a schema file by declaration line", () => {
    const todos = tableFact({ name: "todos", source: ref("db/schema.ts", 10) });
    const projects = tableFact({ name: "projects", source: ref("db/schema.ts", 40) });
    const inTodos = diag("warning", "schema-unknown", ref("db/schema.ts", 22));
    const inProjects = diag("error", "schema-unknown", ref("db/schema.ts", 41));
    const map = buildNodeDiagnostics(
      analysisOf({ tables: [todos, projects], diagnostics: [inTodos, inProjects] }),
    );
    expect(map.get(tableId("todos"))).toEqual([inTodos]);
    expect(map.get(tableId("projects"))).toEqual([inProjects]);
    // One-to-one: the flattened attachments are exactly the attachable diagnostics, once each.
    expect(attachedList(map)).toEqual([inTodos, inProjects]);
  });

  it("leaves a shared-file diagnostic above every declaration unattached (never a guess)", () => {
    const todos = tableFact({ name: "todos", source: ref("db/schema.ts", 10) });
    const projects = tableFact({ name: "projects", source: ref("db/schema.ts", 40) });
    const fileLevel = diag("error", "schema-parse", ref("db/schema.ts", 2));
    const map = buildNodeDiagnostics(
      analysisOf({ tables: [todos, projects], diagnostics: [fileLevel] }),
    );
    expect(attachedList(map)).toEqual([]);
  });

  it("attaches a single-node file's diagnostic even above its declaration line", () => {
    const route = routeFact({ source: ref("server/routes/todos.get.ts", 10) });
    const importError = diag("error", "route-wrapper", ref(route.sourceFile, 1));
    const map = buildNodeDiagnostics(analysisOf({ routes: [route], diagnostics: [importError] }));
    expect(map.get(routeId(route))).toEqual([importError]);
  });

  it("disambiguates views sharing a file and routes sharing a file by line", () => {
    const viewA = viewFact({ name: "a", source: ref("db/views/all.ts", 5) });
    const viewB = viewFact({ name: "b", source: ref("db/views/all.ts", 30) });
    const routeA = routeFact({
      method: "GET",
      path: "/a",
      sourceFile: "server/routes/multi.ts",
      source: ref("server/routes/multi.ts", 2),
    });
    const routeB = routeFact({
      method: "POST",
      path: "/b",
      sourceFile: "server/routes/multi.ts",
      source: ref("server/routes/multi.ts", 20),
    });
    const d1 = diag("warning", "view-unknown", ref("db/views/all.ts", 31));
    const d2 = diag("warning", "route-direct-db", ref("server/routes/multi.ts", 25));
    const map = buildNodeDiagnostics(
      analysisOf({ views: [viewA, viewB], routes: [routeA, routeB], diagnostics: [d1, d2] }),
    );
    expect(map.get(viewId("b"))).toEqual([d1]);
    expect(map.get(routeId(routeB))).toEqual([d2]);
    expect(map.get(viewId("a"))).toBeUndefined();
    expect(map.get(routeId(routeA))).toBeUndefined();
  });

  it("attaches page and workflow diagnostics to their nodes", () => {
    const pageDiag = diag("warning", "page-path-static", ref(pageFact.path, 8));
    const workflowDiag = diag("warning", "workflow-definition", ref(workflowFact.sourceFile, 4));
    const map = buildNodeDiagnostics(
      analysisOf({
        pages: [pageFact],
        workflows: [workflowFact],
        diagnostics: [pageDiag, workflowDiag],
      }),
    );
    expect(map.get("page:" + pageFact.path)).toEqual([pageDiag]);
    expect(map.get("workflow:purge")).toEqual([workflowDiag]);
  });

  it("excludes info diagnostics, null sources and files with no graph node", () => {
    const route = routeFact();
    const info = diag("info", "route-info", ref(route.sourceFile, 4));
    const noSource = diag("error", "config-static", null);
    const config = diag("error", "config-invalid", ref("facilis.config.ts", 2));
    const job = diag("warning", "job-definition", ref("server/jobs/purge.ts", 2));
    const map = buildNodeDiagnostics(
      analysisOf({ routes: [route], diagnostics: [info, noSource, config, job] }),
    );
    expect(attachedList(map)).toEqual([]);
  });

  it("keeps every attachable diagnostic exactly once across all nodes (one-to-one)", () => {
    const todos = tableFact({ name: "todos", source: ref("db/schema.ts", 10) });
    const projects = tableFact({ name: "projects", source: ref("db/schema.ts", 40) });
    const route = routeFact();
    const diagnostics = [
      diag("error", "route-wrapper", ref(route.sourceFile, 3)),
      diag("warning", "route-direct-db", ref(route.sourceFile, 9)),
      diag("warning", "schema-unknown", ref("db/schema.ts", 12)),
      diag("warning", "schema-unknown", ref("db/schema.ts", 44)),
      diag("error", "schema-unknown", ref("db/schema.ts", 50)),
      diag("info", "route-info", ref(route.sourceFile, 5)),
      diag("error", "config-static", null),
    ];
    const map = buildNodeDiagnostics(
      analysisOf({ routes: [route], tables: [todos, projects], diagnostics }),
    );
    const attached = attachedList(map);
    const attachable = diagnostics.filter(
      (entry) => entry.severity !== "info" && entry.source !== null,
    );
    expect(attached).toHaveLength(attachable.length);
    for (const entry of attachable) {
      expect(attached.filter((candidate) => candidate === entry)).toHaveLength(1);
    }
    // Per-node lists preserve the analysis order.
    expect(map.get(routeId(route))).toEqual([diagnostics[0], diagnostics[1]]);
    expect(map.get(tableId("projects"))).toEqual([diagnostics[3], diagnostics[4]]);
  });
});

describe("worstSeverity", () => {
  it("error beats warning, warning beats none", () => {
    const warning = diag("warning", "w", null);
    const error = diag("error", "e", null);
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([warning])).toBe("warning");
    expect(worstSeverity([warning, error])).toBe("error");
    expect(worstSeverity([error, warning])).toBe("error");
  });
});
