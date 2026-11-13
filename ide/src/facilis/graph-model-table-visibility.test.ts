// The project graph's table visibility (D-179): one choice decides which framework tables the
// drawn graph shows, while routes, pages, views and workflows always stay. The three modes are
// pinned end to end here: "project" hides every framework table, "used" keeps the ones the
// project's own facts reference, and "all" (the default) hides nothing.
import { describe, expect, it } from "vitest";
import type { GraphEdgeKind, GraphNodeKind, ProjectGraph } from "@facilis.dev/analyze";
import type { ProjectGraphEdge } from "./graph-types";
import { buildProjectGraphView } from "./graph-model";
import { hiddenTableNodeIds } from "./graph-system";
import {
  PAGE,
  TODOS,
  WORKFLOW,
  graphOf,
  routeNode,
  tableNode,
  viewNode,
} from "./graph-model.test-fixtures";

const FRAMEWORK_DIR = "node_modules/@facilis.dev/";
const FILES = tableNode("facilis_files", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "db/src/files.ts",
});
const USERS = tableNode("users", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "auth/src/tables.ts",
});
const SESSIONS = tableNode("sessions", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "auth/src/tables.ts",
});
const AUTH_IDENTITIES = tableNode("auth_identities", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "auth/src/tables.ts",
});
const ROLES = tableNode("roles", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "auth/src/tables.ts",
});
const JOBS = tableNode("facilis_jobs", {
  framework: true,
  sourceFile: FRAMEWORK_DIR + "db/src/jobs.ts",
});
const VIEW = viewNode("active_todos", { tables: ["users", "auth_identities"] });

const GET_TODOS = routeNode("GET", "/api/todos", { dbTables: ["todos"] });
/** The owner-reported case: a project auth route whose only relation is a framework table. */
const LOGOUT = routeNode("POST", "/api/auth/logout", { dbTables: ["sessions"] });
const REPORT = routeNode("GET", "/api/reports", { dbTables: ["active_todos"] });
const SESSION = routeNode("GET", "/api/auth/session", { dbTables: [] });

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
      GET_TODOS,
      LOGOUT,
      REPORT,
      SESSION,
      TODOS,
      VIEW,
      WORKFLOW,
      FILES,
      USERS,
      SESSIONS,
      AUTH_IDENTITIES,
      ROLES,
      JOBS,
    ],
    [
      edge("page-route", PAGE.id, GET_TODOS.id),
      edge("route-table", GET_TODOS.id, TODOS.id),
      // A framework table referenced through every project-side edge kind the contract names.
      edge("route-table", LOGOUT.id, SESSIONS.id),
      edge("route-view", REPORT.id, VIEW.id),
      edge("fk", TODOS.id, FILES.id),
      edge("relation", TODOS.id, USERS.id),
      edge("view-base", VIEW.id, AUTH_IDENTITIES.id),
      // Framework -> framework wiring: it must not make `roles` used by the project.
      edge("fk", USERS.id, ROLES.id),
    ],
  );

type View = ReturnType<typeof buildProjectGraphView>;

const idsOf = (view: View): string[] => view.nodes.map((node) => node.id).toSorted();
const labelsOf = (view: View, kind: GraphNodeKind): string[] =>
  view.nodes
    .filter((node) => node.kind === kind)
    .map((node) => node.label)
    .toSorted((left, right) => left.localeCompare(right));
const hasEdge = (view: View, source: string, target: string): boolean =>
  view.edges.some((entry) => entry.source === source && entry.target === target);
const yOf = (view: View, id: string): number | undefined =>
  view.nodes.find((node) => node.id === id)?.position.y;

const FRAMEWORK_TABLE_LABELS = [
  "auth_identities",
  "facilis_files",
  "facilis_jobs",
  "roles",
  "sessions",
  "users",
];
/** Referenced only by framework wiring or by nothing at all, so "used" must drop them. */
const HIDDEN_IN_USED = ["facilis_jobs", "roles"];
const PROJECT_SURFACE = [
  PAGE.id,
  GET_TODOS.id,
  LOGOUT.id,
  REPORT.id,
  SESSION.id,
  TODOS.id,
  VIEW.id,
  WORKFLOW.id,
].toSorted();

describe("buildProjectGraphView default table visibility", () => {
  it("shows the whole analysis when no preference is saved", () => {
    const view = buildProjectGraphView({ graph: graph() });
    expect(view.nodes).toHaveLength(14);
    expect(view.edges).toHaveLength(8);
    expect(view.stats.hiddenNodes).toBe(0);
    expect(labelsOf(view, "table")).toEqual([
      "auth_identities",
      "facilis_files",
      "facilis_jobs",
      "roles",
      "sessions",
      "todos",
      "users",
    ]);
  });

  it('treats an explicit "all" exactly like an absent preference', () => {
    const absent = buildProjectGraphView({ graph: graph() });
    const all = buildProjectGraphView({ graph: graph(), tableVisibility: "all" });
    expect(idsOf(all)).toEqual(idsOf(absent));
    expect(all.stats).toEqual(absent.stats);
  });
});

describe('buildProjectGraphView "project" visibility', () => {
  const view = buildProjectGraphView({ graph: graph(), tableVisibility: "project" });

  it("hides every framework table", () => {
    expect(view.stats.hiddenNodes).toBe(6);
    expect(labelsOf(view, "table")).toEqual(["todos"]);
    expect(view.stats.tables).toBe(1);
  });

  it("keeps every route, page, view and workflow", () => {
    expect(idsOf(view)).toEqual(PROJECT_SURFACE);
    expect(view.stats.routes).toBe(4);
    expect(view.stats.pages).toBe(1);
    expect(view.stats.views).toBe(1);
    expect(view.stats.workflows).toBe(1);
  });

  it("drops the edges into hidden tables but keeps the routes they belonged to", () => {
    expect(view.edges.map((entry) => entry.kind)).toEqual([
      "page-route",
      "route-table",
      "route-view",
    ]);
    expect(view.nodes.some((node) => node.id === LOGOUT.id)).toBe(true);
  });
});

describe('buildProjectGraphView "used" visibility', () => {
  const view = buildProjectGraphView({ graph: graph(), tableVisibility: "used" });

  it("keeps the framework tables the project references through any reference edge kind", () => {
    // sessions via route-table, facilis_files via fk, users via relation, auth_identities via view-base.
    expect(labelsOf(view, "table")).toEqual([
      "auth_identities",
      "facilis_files",
      "sessions",
      "todos",
      "users",
    ]);
  });

  it("hides framework tables referenced only by framework facts or by nothing", () => {
    expect(view.stats.hiddenNodes).toBe(2);
    const hidden = FRAMEWORK_TABLE_LABELS.filter(
      (label) => !labelsOf(view, "table").includes(label),
    );
    expect(hidden).toEqual(HIDDEN_IN_USED);
    expect(view.nodes.some((node) => node.id === ROLES.id)).toBe(false);
    expect(view.nodes.some((node) => node.id === JOBS.id)).toBe(false);
  });

  it("keeps the owner-reported logout -> sessions edge", () => {
    expect(hasEdge(view, LOGOUT.id, SESSIONS.id)).toBe(true);
    expect(view.edges).toHaveLength(7);
  });

  it("does not count a framework -> framework edge as a project use", () => {
    expect(view.nodes.some((node) => node.id === USERS.id)).toBe(true);
    expect(view.nodes.some((node) => node.id === ROLES.id)).toBe(false);
  });

  it("shows the same routes, pages, views and workflows as the other modes", () => {
    const project = buildProjectGraphView({ graph: graph(), tableVisibility: "project" });
    const all = buildProjectGraphView({ graph: graph(), tableVisibility: "all" });
    for (const kind of ["route", "page", "view", "workflow"] as const) {
      expect(labelsOf(view, kind)).toEqual(labelsOf(all, kind));
      expect(labelsOf(view, kind)).toEqual(labelsOf(project, kind));
    }
  });
});

describe("buildProjectGraphView with saved positions and layout", () => {
  it("keeps a saved position for a visible node and drops the hidden one", () => {
    const view = buildProjectGraphView({
      graph: graph(),
      tableVisibility: "used",
      positions: {
        [TODOS.id]: { x: 10, y: 20 },
        [ROLES.id]: { x: 99, y: 99 },
      },
    });
    expect(view.nodes.find((node) => node.id === TODOS.id)?.position).toEqual({ x: 10, y: 20 });
    expect(view.nodes.some((node) => node.id === ROLES.id)).toBe(false);
  });

  it("compacts the automatic layout instead of leaving a hole", () => {
    const all = buildProjectGraphView({ graph: graph() });
    const project = buildProjectGraphView({ graph: graph(), tableVisibility: "project" });
    // Unfiltered, the project table sits below the framework rows; filtered, it starts at 0.
    expect(yOf(all, TODOS.id)).toBeGreaterThan(0);
    expect(yOf(project, TODOS.id)).toBe(0);
  });
});

describe("hiddenTableNodeIds", () => {
  it("does not count an edge whose source node is not in the graph", () => {
    const all = buildProjectGraphView({ graph: graph() });
    const withoutLogout = all.nodes.filter((node) => node.id !== LOGOUT.id);
    // The route is gone, so its route-table edge cannot make sessions used; jobs and roles stay
    // unused as before.
    const hidden = hiddenTableNodeIds(withoutLogout, all.edges, "used");
    expect([...hidden].toSorted()).toEqual([JOBS.id, ROLES.id, SESSIONS.id].toSorted());
  });
});
