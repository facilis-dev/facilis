// End-to-end regression for the framework tables in the project graph.
//
// The IDE's VFS snapshot never lists node_modules, so the analyzer only sees the tables
// declared in project source unless framework-sources.ts inlines the installed @facilis.dev
// source. db/schema.ts re-exports framework state from @facilis.dev/auth and @facilis.dev/db: with
// that source missing the analyzer silently drops those tables (and the FK/route edges to
// them) and the graph shows only the two application tables.
import { analyzeProject, type Analysis } from "@facilis.dev/analyze";
import { describe, expect, it } from "vitest";
import { exampleProjectFiles } from "./example-template";
import { frameworkProjectFiles } from "./framework-sources";
import { buildProjectGraphView } from "./graph-model";
import { createBrowserOxcParser } from "./oxc-browser";

const parser = createBrowserOxcParser();

/** The files a VFS snapshot yields today: project source only, no node_modules. */
const projectFiles: ReadonlyMap<string, string> = new Map(Object.entries(exampleProjectFiles()));

/** The files the IDE actually analyzes: the project plus the inlined framework source. */
const analyzedFiles: ReadonlyMap<string, string> = new Map([
  ...projectFiles,
  ...frameworkProjectFiles(),
]);

function analyze(files: ReadonlyMap<string, string>): Analysis {
  return analyzeProject({ files, parser });
}

function edgeBetween(
  analysis: Analysis,
  source: string,
  target: string,
): Analysis["graph"]["edges"][number] | undefined {
  return analysis.graph.edges.find((edge) => edge.source === source && edge.target === target);
}

function tableNames(analysis: Analysis): string[] {
  return analysis.tables
    .map((table) => table.name)
    .toSorted((left, right) => left.localeCompare(right));
}

/** Table labels the drawn view keeps, sorted, so a mode's table surface is one assertion. */
function drawnTableNames(view: ReturnType<typeof buildProjectGraphView>): string[] {
  return view.nodes
    .filter((node) => node.kind === "table")
    .map((node) => node.label)
    .toSorted((left, right) => left.localeCompare(right));
}

function routeCount(view: ReturnType<typeof buildProjectGraphView>): number {
  return view.nodes.filter((node) => node.kind === "route").length;
}

/** Route labels the drawn view keeps, sorted, so modes can be compared as one surface. */
function drawnRouteLabels(view: ReturnType<typeof buildProjectGraphView>): string[] {
  return view.nodes
    .filter((node) => node.kind === "route")
    .map((node) => node.label)
    .toSorted((left, right) => left.localeCompare(right));
}

const LOGOUT = "route:POST /api/auth/logout";
const SESSIONS = "table:sessions";

describe("project analysis with framework sources", () => {
  const analysis = analyze(analyzedFiles);

  it("resolves every table db/schema.ts re-exports from the framework packages", () => {
    expect(tableNames(analysis)).toEqual([
      "api_clients",
      "api_tokens",
      "auth_email_verifications",
      "auth_identities",
      "auth_sso_states",
      "facilis_files",
      "facilis_jobs",
      "facilis_tasks",
      "facilis_workflows",
      "role_permissions",
      "roles",
      "sessions",
      "todo_files",
      "todos",
      "user_roles",
      "users",
    ]);
    expect(analysis.graph.nodes).toHaveLength(42);
    // 63 after D-157 and the W1/W3 routes: session/jobs routes no longer declare tables they
    // do not touch, while the task and workflow routes add their own route-table edges.
    expect(analysis.graph.edges).toHaveLength(63);
  });

  it("links the file route and the re-exported tables through the graph", () => {
    // GET /api/files/{id} declares facilis_files in dbTables; todo_files points at it by FK
    // and sessions at users; all three targets only exist via the framework source.
    expect(edgeBetween(analysis, "route:GET /api/files/{id}", "table:facilis_files")).toMatchObject(
      { kind: "route-table", label: "dbTables" },
    );
    expect(edgeBetween(analysis, "table:todo_files", "table:facilis_files")).toMatchObject({
      kind: "fk",
    });
    expect(edgeBetween(analysis, "table:sessions", "table:users")).toMatchObject({ kind: "fk" });
  });

  it("reports no error diagnostics for the analyzed project", () => {
    expect(analysis.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });

  // D-179 end to end: the owner-reported regression was the logout route losing its sessions
  // association because the old route heuristic treated a route whose dbTables name only
  // framework tables as framework code and filtered it out. Every route the analysis sees is
  // project code, so the edge below exists in the analyzed graph and no mode may hide a route.
  it("keeps the logout route's sessions association in the full graph", () => {
    expect(edgeBetween(analysis, LOGOUT, SESSIONS)).toMatchObject({
      kind: "route-table",
      label: "dbTables",
    });
  });

  it('draws the whole analysis when no visibility preference is saved ("all" default)', () => {
    const view = buildProjectGraphView({ graph: analysis.graph });
    expect(view.nodes).toHaveLength(42);
    expect(view.edges).toHaveLength(63);
    expect(view.stats.hiddenNodes).toBe(0);
    expect(routeCount(view)).toBe(21);
    expect(drawnTableNames(view)).toEqual([
      "api_clients",
      "api_tokens",
      "auth_email_verifications",
      "auth_identities",
      "auth_sso_states",
      "facilis_files",
      "facilis_jobs",
      "facilis_tasks",
      "facilis_workflows",
      "role_permissions",
      "roles",
      "sessions",
      "todo_files",
      "todos",
      "user_roles",
      "users",
    ]);
  });

  it('hides every framework table and no route in "project" mode', () => {
    const view = buildProjectGraphView({ graph: analysis.graph, tableVisibility: "project" });
    expect(view.stats.hiddenNodes).toBe(14);
    expect(view.nodes).toHaveLength(28);
    expect(view.edges).toHaveLength(23);
    expect(drawnTableNames(view)).toEqual(["todo_files", "todos"]);
    // The visibility choice never filters routes, pages or workflows: all of the starter's
    // surface stays drawn even though the auth routes only name framework tables.
    expect(routeCount(view)).toBe(21);
    expect(view.nodes.filter((node) => node.kind === "page")).toHaveLength(4);
    expect(view.nodes.filter((node) => node.kind === "workflow")).toHaveLength(1);
    expect(view.nodes.some((node) => node.id === LOGOUT)).toBe(true);
    expect(view.nodes.some((node) => node.id === SESSIONS)).toBe(false);
  });

  it('keeps the framework tables the project actually uses in "used" mode', () => {
    const view = buildProjectGraphView({ graph: analysis.graph, tableVisibility: "used" });
    expect(view.stats.hiddenNodes).toBe(4);
    expect(view.nodes).toHaveLength(38);
    expect(view.edges).toHaveLength(61);
    expect(drawnTableNames(view)).toEqual([
      "api_clients",
      "api_tokens",
      "auth_email_verifications",
      "facilis_files",
      "facilis_tasks",
      "facilis_workflows",
      "roles",
      "sessions",
      "todo_files",
      "todos",
      "user_roles",
      "users",
    ]);
    // The owner-reported case: sessions is referenced by the project's logout route, so it stays
    // drawn and the route-table edge survives instead of being dropped with the table.
    expect(view.nodes.some((node) => node.id === SESSIONS)).toBe(true);
    expect(view.edges.some((edge) => edge.source === LOGOUT && edge.target === SESSIONS)).toBe(
      true,
    );
    expect(routeCount(view)).toBe(21);
  });

  it('hides only framework tables no project fact references in "used" mode', () => {
    const view = buildProjectGraphView({ graph: analysis.graph, tableVisibility: "used" });
    const hidden = analysis.graph.nodes
      .filter(
        (node) =>
          node.data.kind === "table" &&
          node.data.framework &&
          !view.nodes.some((drawn) => drawn.id === node.id),
      )
      .map((node) => node.label)
      .toSorted((left, right) => left.localeCompare(right));
    expect(hidden).toEqual([
      "auth_identities",
      "auth_sso_states",
      "facilis_jobs",
      "role_permissions",
    ]);
    // At least one hidden table is genuinely unused: the analyzed graph has no edge into
    // facilis_jobs at all (POST /api/jobs enqueues through ctx.jobs and declares no relation),
    // so only framework-internal facts could have kept it.
    expect(analysis.graph.edges.some((edge) => edge.target === "table:facilis_jobs")).toBe(false);
  });

  it("draws the same routes in all three modes", () => {
    const views = (["project", "used", "all"] as const).map((tableVisibility) =>
      buildProjectGraphView({ graph: analysis.graph, tableVisibility }),
    );
    for (const view of views) expect(routeCount(view)).toBe(21);
    for (const view of views.slice(1)) {
      expect(drawnRouteLabels(view)).toEqual(drawnRouteLabels(views[0]));
    }
  });
});

// Documents the regression this module fixes: the same project without the framework source
// loses every re-exported table, and the route/FK edges that target them with it.
describe("project analysis without framework sources", () => {
  const analysis = analyze(projectFiles);

  it("keeps only the locally declared tables", () => {
    expect(tableNames(analysis)).toEqual(["todo_files", "todos"]);
    expect(analysis.graph.nodes).toHaveLength(28);
    expect(analysis.graph.edges).toHaveLength(23);
  });

  it("drops the route and FK edges into framework state", () => {
    expect(
      edgeBetween(analysis, "route:GET /api/files/{id}", "table:facilis_files"),
    ).toBeUndefined();
    expect(edgeBetween(analysis, "table:todo_files", "table:facilis_files")).toBeUndefined();
  });
});
