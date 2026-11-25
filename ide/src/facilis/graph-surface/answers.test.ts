// Unit tests for the inspector's pure answers (issue #190): the fixture covers a transitive
// page -> route -> table/view set, a reverse-closure impact graph, FK + view fan-in, cross-domain
// grouping and the unknown state. ide/ ships no jsdom, so this is a plain Vitest module.
import { describe, expect, it } from "vitest";
import type { GraphDiagnostic, ProjectGraph } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { createAnswerContext, edgeNodes } from "@/facilis/graph-surface/answers-context";
import { buildNodeAnswerSections } from "@/facilis/graph-surface/answers";
import {
  elevatedRoutes,
  pagesOfRoute,
  relationsOfPage,
  routeOverviewRows,
  routesOfPage,
} from "@/facilis/graph-surface/answers-questions";
import {
  externalReferences,
  impactIfDropped,
  nodeSource,
  sharedGroups,
  tableSecurityRows,
  tableSecuritySummary,
  tableUsageRows,
  unknownFacts,
} from "@/facilis/graph-surface/answers-usage";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
  workflowNode,
} from "@/facilis/graph-model.test-fixtures";

const ADMIN_PAGE = pageNode("src/pages/admin/users.tsx", 1);
const INDEX_PAGE = pageNode("src/pages/index.tsx", 1);
const ADMIN_ROUTE = routeNode("GET", "/admin/users", {
  dbTables: ["active_users", "users"],
  input: { body: true, form: false, query: true, params: false },
  sourceFile: "server/routes/admin/users.get.ts",
});
const API_ROUTE = routeNode("GET", "/api/users", {
  dbTables: ["users"],
  sourceFile: "server/routes/api/users.get.ts",
});
const TODO_ROUTE = routeNode("POST", "/api/todos", {
  dbTables: ["todos"],
  sourceFile: "server/routes/api/todos.post.ts",
});
const USERS = tableNode("users", {
  policies: [
    { name: "users_tenant", restrictive: false },
    { name: "admin_only", restrictive: true },
  ],
});
const SESSIONS = tableNode("sessions");
const TODOS = tableNode("todos");
const LEGACY = tableNode("legacy", { unknown: true, rlsEnabled: false });
const ACTIVE_USERS = viewNode("active_users", {
  tables: ["users"],
  permission: "users:read",
  access: "definer",
});
const PURGE = workflowNode("purge", [{ index: 0, kind: "job", name: "purge-users" }]);

let edgeCount = 0;
function edge(
  kind: ProjectGraph["edges"][number]["kind"],
  source: string,
  target: string,
  extra: Partial<ProjectGraph["edges"][number]> = {},
): ProjectGraph["edges"][number] {
  edgeCount += 1;
  return { id: kind + ":" + edgeCount, kind, source, target, label: null, ...extra };
}

const graph = graphOf(
  [
    ADMIN_PAGE,
    INDEX_PAGE,
    ADMIN_ROUTE,
    API_ROUTE,
    TODO_ROUTE,
    USERS,
    SESSIONS,
    TODOS,
    LEGACY,
    ACTIVE_USERS,
    PURGE,
  ],
  [
    edge("page-route", ADMIN_PAGE.id, ADMIN_ROUTE.id),
    edge("page-route", INDEX_PAGE.id, TODO_ROUTE.id),
    edge("page-link", INDEX_PAGE.id, ADMIN_PAGE.id),
    edge("route-view", ADMIN_ROUTE.id, ACTIVE_USERS.id),
    edge("route-table", ADMIN_ROUTE.id, USERS.id, { access: "elevated" }),
    edge("route-table", API_ROUTE.id, USERS.id),
    edge("route-table", TODO_ROUTE.id, TODOS.id),
    edge("view-base", ACTIVE_USERS.id, USERS.id),
    edge("fk", SESSIONS.id, USERS.id),
  ],
);

const diagnostics: readonly GraphDiagnostic[] = [
  { nodeId: ADMIN_ROUTE.id, code: "elevated", params: {} },
  { nodeId: LEGACY.id, code: "unknown", params: {} },
];

const details = new Map<string, NodeDetails>([
  [
    ADMIN_ROUTE.id,
    {
      kind: "route",
      route: {
        source: { file: "server/routes/admin/users.get.ts", line: 4 },
        dbColumns: [],
        crossSite: false,
        rawSql: false,
        handlerBodyRead: true,
        handlerFormRead: false,
        relations: { used: [], unresolved: 0, rawSql: 0, opaque: false },
        elevations: [
          {
            kind: "sudo",
            operation: "read users",
            tables: ["users"],
            source: { file: "server/routes/admin/users.get.ts", line: 12 },
          },
        ],
      },
    },
  ],
  [
    USERS.id,
    {
      kind: "table",
      table: {
        source: { file: "db/schema.ts", line: 10 },
        columns: [],
        policies: [
          { name: "users_tenant", command: "SELECT", restrictive: false },
          { name: "admin_only", command: "INSERT", restrictive: true },
        ],
        foreignKeys: [],
        relations: [],
      },
    },
  ],
  [
    ADMIN_PAGE.id,
    {
      kind: "page",
      page: { source: { file: "src/pages/admin/users.tsx", line: 2 }, calls: [] },
    },
  ],
  [ACTIVE_USERS.id, { kind: "view", view: { source: { file: "db/views/users.ts", line: 1 } } }],
  [
    PURGE.id,
    {
      kind: "workflow",
      workflow: {
        source: { file: "server/workflows/purge.ts", line: 1 },
        tables: ["users"],
        unknownJobs: [],
        unknown: false,
      },
    },
  ],
]);

const view = buildProjectGraphView({ graph });
const ctx = createAnswerContext(view, details, diagnostics);
const byId = (id: string) => {
  const node = view.nodes.find((entry) => entry.id === id);
  if (node === undefined) throw new Error("missing fixture node " + id);
  return node;
};

const ids = (rows: readonly { nodeId: string | null }[]) => rows.map((row) => row.nodeId);

describe("inspector answers", () => {
  it("Q1/Q2 link a page to its routes and back", () => {
    expect(ids(routesOfPage(byId(ADMIN_PAGE.id), ctx))).toEqual([ADMIN_ROUTE.id]);
    expect(routesOfPage(byId(ADMIN_ROUTE.id), ctx)).toEqual([]);
    expect(ids(pagesOfRoute(byId(ADMIN_ROUTE.id), ctx))).toEqual([ADMIN_PAGE.id]);
  });

  it("Q3 walks page -> route -> table/view and tags read/write", () => {
    const rows = relationsOfPage(byId(ADMIN_PAGE.id), ctx);
    expect(ids(rows).toSorted()).toEqual([ACTIVE_USERS.id, USERS.id].toSorted());
    expect(rows.find((row) => row.nodeId === USERS.id)?.access).toBe("read");
    expect(rows.find((row) => row.nodeId === ACTIVE_USERS.id)?.access).toBe("read");
  });

  it("Q4 shares the elevated lens facts and joins the route detail", () => {
    expect(ids(elevatedRoutes(byId(ADMIN_ROUTE.id), ctx))).toEqual([ADMIN_ROUTE.id]);
    expect(ids(elevatedRoutes(byId(ADMIN_PAGE.id), ctx))).toEqual([ADMIN_ROUTE.id]);
    expect(ids(elevatedRoutes(byId(USERS.id), ctx))).toEqual([ADMIN_ROUTE.id]);
    expect(elevatedRoutes(byId(TODOS.id), ctx)).toEqual([]);
  });

  it("Q5 lists policies with their grant command and the RLS class", () => {
    const rows = tableSecurityRows(byId(USERS.id), ctx);
    expect(rows.map((row) => row.label)).toEqual(["users_tenant", "admin_only"]);
    expect(rows[0]?.detail).toBe("SELECT");
    expect(rows[1]?.detailKey).toBe("projectGraph.flag.restrictive");
    expect(tableSecuritySummary(byId(USERS.id))?.key).toBe(
      "projectGraph.surface.answers.rls.enabled",
    );
    expect(tableSecuritySummary(byId(LEGACY.id))?.key).toBe(
      "projectGraph.surface.answers.rls.systemOnly",
    );
  });

  it("Q6 shows wrapper, permission and declared input schemas", () => {
    const rows = routeOverviewRows(byId(ADMIN_ROUTE.id), ctx);
    expect(rows[0]?.detailKey).toBe("projectGraph.wrapper.valid");
    expect(rows[1]?.detail).toBe("todos:read");
    expect(rows.some((row) => row.labelKey === "projectGraph.input.body")).toBe(true);
    expect(rows.some((row) => row.labelKey === "projectGraph.input.query")).toBe(true);
  });

  it("Q7 fans in routes, foreign keys and views", () => {
    const rows = tableUsageRows(byId(USERS.id), ctx);
    expect(ids(rows)).toContain(ADMIN_ROUTE.id);
    expect(ids(rows)).toContain(API_ROUTE.id);
    expect(ids(rows)).toContain(SESSIONS.id);
    expect(ids(rows)).toContain(ACTIVE_USERS.id);
    expect(rows.find((row) => row.nodeId === API_ROUTE.id)?.access).toBe("read");
  });

  it("Q8 groups external references and includes same-domain views", () => {
    const rows = externalReferences(byId(USERS.id), ctx);
    expect(rows.some((row) => row.nodeId === API_ROUTE.id && row.group === "api")).toBe(true);
    expect(rows.some((row) => row.nodeId === ACTIVE_USERS.id)).toBe(true);
  });

  it("Q9 counts references per domain and stays empty below two domains", () => {
    const rows = sharedGroups(byId(USERS.id), ctx);
    expect(new Set(rows.map((row) => row.group))).toEqual(new Set(["api", "core"]));
    expect(rows.find((row) => row.nodeId === API_ROUTE.id)?.detailParams).toEqual({ count: 1 });
    expect(sharedGroups(byId(TODOS.id), ctx)).toEqual([]);
  });

  it("Q10 closes over routes, views, FKs, pages and workflows", () => {
    const dependents = new Set(impactIfDropped(byId(USERS.id), ctx).map((row) => row.nodeId));
    expect(dependents).toEqual(
      new Set([
        SESSIONS.id,
        ACTIVE_USERS.id,
        ADMIN_ROUTE.id,
        API_ROUTE.id,
        ADMIN_PAGE.id,
        INDEX_PAGE.id,
        PURGE.id,
      ]),
    );
  });

  it("Q16 carries the source line, Q17 the shared unknown label", () => {
    const source = nodeSource(byId(USERS.id), ctx)[0];
    expect(source?.label).toBe("db/schema.ts");
    expect(source?.detailParams).toEqual({ line: 10 });
    const unknown = unknownFacts(byId(LEGACY.id), ctx);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.labelKey).toBe("projectGraph.surface.diag.unknown.label");
  });

  it("selects the questions that apply to the node kind", () => {
    expect(buildNodeAnswerSections(byId(ADMIN_PAGE.id), ctx).map((s) => s.id)).toEqual([
      "q1",
      "q3",
      "q4",
      "q8",
      "q9",
      "q10",
      "q16",
      "q17",
    ]);
    expect(buildNodeAnswerSections(byId(USERS.id), ctx).map((s) => s.id)).toEqual([
      "q5",
      "q7",
      "q8",
      "q9",
      "q10",
      "q16",
      "q17",
    ]);
  });

  it("keeps the context index pure", () => {
    expect(edgeNodes(undefined, ctx, "target")).toEqual([]);
  });
});
