// The project graph's system-node filters (D-163): framework-declared tables and the routes that
// belong to the framework's feature surface (auth, jobs, workflows, files) can be hidden so the
// graph shows the project's own API. Unknown routes are never classified away: the graph is also
// the integrity view.
import { describe, expect, it } from "vitest";
import type { GraphEdgeKind, ProjectGraph } from "@facilis.dev/analyze";
import type { ProjectGraphEdge } from "./graph-types";
import { buildProjectGraphView } from "./graph-model";
import { isSystemRoute, isSystemTable } from "./graph-system";
import { PAGE, TODOS, graphOf, routeNode, tableNode, viewNode } from "./graph-model.test-fixtures";

const FILES = tableNode("facilis_files", {
  framework: true,
  sourceFile: "node_modules/@facilis.dev/db/src/files.ts",
});
const USERS = tableNode("users", {
  framework: true,
  sourceFile: "node_modules/@facilis.dev/auth/src/tables.ts",
});
const ROLES = tableNode("roles", {
  framework: true,
  sourceFile: "node_modules/@facilis.dev/auth/src/tables.ts",
});
const JOBS = tableNode("facilis_jobs", {
  framework: true,
  sourceFile: "node_modules/@facilis.dev/db/src/jobs.ts",
});
const ACTIVE_TODOS = viewNode("active_todos", { tables: ["todos"] });

const GET = routeNode("GET", "/api/todos", { dbTables: ["todos"] });
const AUTH = routeNode("POST", "/api/auth/login", {
  permission: [],
  dbTables: ["users", "sessions"],
});
const SESSION = routeNode("GET", "/api/auth/session", { permission: [], dbTables: [] });
const JOBS_RUN = routeNode("POST", "/api/jobs", { permission: ["jobs:exec"], dbTables: [] });
const FRAMEWORK_FILE = routeNode("GET", "/api/auth/token", {
  permission: [],
  dbTables: ["todos"],
  sourceFile: "node_modules/@facilis.dev/nitro/src/routes/token.post.ts",
});
const UNKNOWN = routeNode("GET", "/api/mystery", { dbTables: [], unknown: true });
const REPORT = routeNode("GET", "/api/reports", { dbTables: ["active_todos"] });

const edge = (kind: GraphEdgeKind, source: string, target: string): ProjectGraphEdge => ({
  id: kind + ":" + source + ":" + target,
  kind,
  source,
  target,
  label: null,
});

const graph = (): ProjectGraph =>
  graphOf(
    [
      PAGE,
      GET,
      AUTH,
      SESSION,
      JOBS_RUN,
      FRAMEWORK_FILE,
      UNKNOWN,
      REPORT,
      TODOS,
      FILES,
      USERS,
      ROLES,
      JOBS,
      ACTIVE_TODOS,
    ],
    [
      edge("page-route", PAGE.id, GET.id),
      edge("route-table", GET.id, TODOS.id),
      edge("route-table", GET.id, FILES.id),
      edge("route-table", AUTH.id, USERS.id),
      edge("route-table", JOBS_RUN.id, JOBS.id),
      edge("route-view", REPORT.id, ACTIVE_TODOS.id),
      edge("fk", TODOS.id, FILES.id),
      edge("fk", ROLES.id, USERS.id),
    ],
  );

const idsOf = (view: ReturnType<typeof buildProjectGraphView>): string[] =>
  view.nodes.map((node) => node.id).toSorted();

describe("system classification", () => {
  it("reads framework tables from the analyzer's framework flag", () => {
    const view = buildProjectGraphView({ graph: graph() });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(isSystemTable(byId.get(FILES.id)!)).toBe(true);
    expect(isSystemTable(byId.get(TODOS.id)!)).toBe(false);
    expect(isSystemTable(byId.get(PAGE.id)!)).toBe(false);
  });

  it("classifies a route by framework source or by naming no project relation", () => {
    const relations = new Set(["todos", "active_todos", "facilis_files"]);
    const view = buildProjectGraphView({ graph: graph() });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(isSystemRoute(byId.get(GET.id)!, relations)).toBe(false);
    expect(isSystemRoute(byId.get(REPORT.id)!, relations)).toBe(false);
    expect(isSystemRoute(byId.get(AUTH.id)!, relations)).toBe(true);
    expect(isSystemRoute(byId.get(SESSION.id)!, relations)).toBe(true);
    expect(isSystemRoute(byId.get(JOBS_RUN.id)!, relations)).toBe(true);
    expect(isSystemRoute(byId.get(FRAMEWORK_FILE.id)!, relations)).toBe(true);
  });

  it("never classifies an unknown route as system", () => {
    const view = buildProjectGraphView({ graph: graph() });
    const unknown = view.nodes.find((node) => node.id === UNKNOWN.id);
    expect(unknown).toBeDefined();
    expect(isSystemRoute(unknown!, new Set())).toBe(false);
  });
});

describe("buildProjectGraphView system filters", () => {
  it("shows everything when both filters are off", () => {
    const view = buildProjectGraphView({ graph: graph() });
    expect(view.stats.hiddenNodes).toBe(0);
    expect(view.edges.length).toBe(8);
    expect(view.nodes.length).toBe(14);
  });

  it("hides framework tables no project route uses", () => {
    const view = buildProjectGraphView({ graph: graph(), hideSystemTables: true });
    // facilis_files stays: a project route declares it.
    expect(idsOf(view)).toEqual(
      [
        PAGE.id,
        GET.id,
        AUTH.id,
        SESSION.id,
        JOBS_RUN.id,
        FRAMEWORK_FILE.id,
        UNKNOWN.id,
        REPORT.id,
        TODOS.id,
        FILES.id,
        ACTIVE_TODOS.id,
      ].toSorted(),
    );
    expect(view.stats.tables).toBe(2);
    expect(view.stats.hiddenNodes).toBe(3);
    expect(view.stats.unknownNodes).toBe(1);
    // The edges into hidden tables go with them; the project route's own edge stays.
    expect(view.edges.map((entry) => entry.kind)).toEqual([
      "page-route",
      "route-table",
      "route-table",
      "route-view",
      "fk",
    ]);
  });

  it("hides system routes but keeps project and unknown routes", () => {
    const view = buildProjectGraphView({ graph: graph(), hideSystemRoutes: true });
    expect(idsOf(view)).toEqual(
      [
        PAGE.id,
        GET.id,
        UNKNOWN.id,
        REPORT.id,
        TODOS.id,
        FILES.id,
        USERS.id,
        ROLES.id,
        JOBS.id,
        ACTIVE_TODOS.id,
      ].toSorted(),
    );
    expect(view.stats.routes).toBe(3);
    expect(view.stats.hiddenNodes).toBe(4);
    // The auth and jobs route edges disappear with their routes.
    expect(view.edges.map((entry) => entry.kind)).toEqual([
      "page-route",
      "route-table",
      "route-table",
      "route-view",
      "fk",
      "fk",
    ]);
  });

  it("leaves only the project surface when both filters are on", () => {
    const view = buildProjectGraphView({
      graph: graph(),
      hideSystemRoutes: true,
      hideSystemTables: true,
    });
    expect(idsOf(view)).toEqual(
      [PAGE.id, GET.id, UNKNOWN.id, REPORT.id, TODOS.id, FILES.id, ACTIVE_TODOS.id].toSorted(),
    );
    expect(view.stats.hiddenNodes).toBe(7);
    expect(view.stats.routes).toBe(3);
    expect(view.stats.tables).toBe(2);
    expect(view.stats.edges).toBe(5);
  });

  it("keeps a saved position for a visible node and drops the hidden one", () => {
    const view = buildProjectGraphView({
      graph: graph(),
      hideSystemTables: true,
      positions: {
        [TODOS.id]: { x: 10, y: 20 },
        [ROLES.id]: { x: 99, y: 99 },
      },
    });
    const todos = view.nodes.find((node) => node.id === TODOS.id);
    expect(todos?.position).toEqual({ x: 10, y: 20 });
    expect(view.nodes.some((node) => node.id === ROLES.id)).toBe(false);
  });

  it("compacts the automatic layout instead of leaving a hole", () => {
    const all = buildProjectGraphView({ graph: graph() });
    const filtered = buildProjectGraphView({ graph: graph(), hideSystemTables: true });
    const yOf = (view: ReturnType<typeof buildProjectGraphView>, id: string): number | undefined =>
      view.nodes.find((node) => node.id === id)?.position.y;
    // Unfiltered, the two project tables sit below the framework ones; filtered, they start at 0.
    expect(yOf(all, TODOS.id)).toBeGreaterThan(0);
    expect(yOf(filtered, TODOS.id)).toBe(0);
    expect(yOf(filtered, FILES.id)).toBeGreaterThan(yOf(filtered, TODOS.id) ?? 0);
  });
});
