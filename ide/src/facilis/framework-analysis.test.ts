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

  // D-163 end to end: the two system filters leave the starter's own surface (the todo routes and
  // the tables they declare), so the declutter is pinned against the real analyzed project.
  it("filters the framework feature surface out of the drawn graph", () => {
    const view = buildProjectGraphView({
      graph: analysis.graph,
      hideSystemRoutes: true,
      hideSystemTables: true,
    });
    expect(view.nodes).toHaveLength(14);
    expect(view.edges).toHaveLength(25);
    expect(view.stats.hiddenNodes).toBe(28);
    expect(view.stats.routes).toBe(6);
    expect(view.stats.tables).toBe(3);
    expect(
      view.nodes
        .filter((node) => node.kind === "route")
        .map((node) => node.label)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([
      "DELETE /api/todos/{id}",
      "DELETE /api/todos/{id}/files/{fileId}",
      "GET /api/todos",
      "PATCH /api/todos/{id}",
      "POST /api/todos",
      "POST /api/todos/{id}/files",
    ]);
    expect(
      view.nodes
        .filter((node) => node.kind === "table")
        .map((node) => node.label)
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["facilis_files", "todo_files", "todos"]);
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
