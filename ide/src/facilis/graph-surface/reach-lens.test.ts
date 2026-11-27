// The reach lens's facts (D-225, Q20): the declared permission rule, the wildcard expansion,
// the public callout and the unknown-permission case. Pure inputs, so the matching semantics are
// pinned here independently of the framework's roles.ts.

import type { ElevationFact } from "@facilis.dev/analyze";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { buildReachLensState, defaultReachRole, type ReachConfig } from "./reach-lens.ts";
import { surfaceLayoutKey } from "./positions.ts";

const STATS = {
  pages: 1,
  routes: 4,
  tables: 1,
  views: 0,
  workflows: 0,
  edges: 4,
  hiddenEdges: 0,
  hiddenNodes: 0,
  matches: 0,
  unknownNodes: 0,
  pageLinks: 0,
  elevatedEdges: 0,
};

const CONFIG: ReachConfig = {
  roles: { admin: ["*"], member: ["todos:read"] },
  permissions: ["todos:read", "todos:write"],
  defaultRole: "member",
};

function routeNode(
  method: "GET" | "POST",
  path: string,
  permission: readonly string[],
  elevations: readonly ElevationFact[] = [],
) {
  return {
    id: "route:" + method + " " + path,
    kind: "route" as const,
    label: method + " " + path,
    sourceFile: "server/routes" + path + ".ts",
    position: { x: 1, y: 2 },
    matched: true,
    collapsed: false,
    data: {
      kind: "route" as const,
      method,
      path,
      permission,
      wrapper: "valid" as const,
      description: null,
      input: { body: false, form: false, query: false, params: false },
      pathParams: [],
      dbTables: [],
      elevations,
      unknown: false,
    },
  };
}

function tableNode(table: string) {
  return {
    id: "table:" + table,
    kind: "table" as const,
    label: table,
    sourceFile: "db/schema.ts",
    position: { x: 3, y: 4 },
    matched: true,
    collapsed: false,
    data: {
      kind: "table" as const,
      table,
      columns: [],
      rlsEnabled: true,
      scope: null,
      policies: [],
      framework: false,
      unknown: false,
    },
  };
}

function pageNode(path: string) {
  return {
    id: "page:" + path,
    kind: "page" as const,
    label: path,
    sourceFile: path,
    position: { x: 5, y: 6 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page" as const,
      pagePath: path,
      pageKind: "page" as const,
      callCount: 2,
      routePaths: [],
      preview: null,
    },
  };
}

const READ = routeNode("GET", "/api/todos", ["todos:read"]);
const WRITE = routeNode("POST", "/api/todos", ["todos:write"]);
const STATS_ROUTE = routeNode("GET", "/api/stats", []);
const BILLING = routeNode("GET", "/api/billing", ["billing:read"]);
const PAGE = pageNode("src/pages/todos.tsx");
const TABLE = tableNode("todos");

function edge(id: string, kind: "page-route" | "route-table", source: string, target: string) {
  return { id, kind, source, target, label: null };
}

const VIEW: ProjectGraphView = {
  nodes: [READ, WRITE, STATS_ROUTE, PAGE, TABLE],
  edges: [
    edge("e1", "page-route", PAGE.id, READ.id),
    edge("e2", "page-route", PAGE.id, WRITE.id),
    edge("e3", "route-table", READ.id, TABLE.id),
    edge("e4", "route-table", WRITE.id, TABLE.id),
  ],
  stats: STATS,
};

function codesOf(state: ReturnType<typeof buildReachLensState>): string[] {
  return state.facts.map((fact) => fact.code);
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("reach lens", () => {
  it("highlights exactly what the member's permission unlocks", () => {
    const state = buildReachLensState(CONFIG, VIEW, "member", () => {});
    const flagged = new Set(state.highlight);
    expect(flagged.has(READ.id)).toBe(true);
    expect(flagged.has(PAGE.id)).toBe(true);
    expect(flagged.has(TABLE.id)).toBe(true);
    expect(flagged.has(STATS_ROUTE.id)).toBe(true);
    expect(flagged.has(WRITE.id)).toBe(false);
    expect(state.totals).toMatchObject({ count: 2, params: { pages: 1, tables: 1 } });
    expect(
      t(state.totals?.key ?? "projectGraph.surface.state.emptyTitle", {
        count: state.totals?.count ?? 0,
        ...state.totals?.params,
      }),
    ).toContain("2 routes · pages: 1 · tables: 1");
  });

  it("calls out a public route and names the permission of a reachable one", () => {
    const state = buildReachLensState(CONFIG, VIEW, "member", () => {});
    const publicFact = state.facts.find((fact) => fact.code === "state.publicRoute");
    expect(publicFact?.nodeId).toBe(STATS_ROUTE.id);
    const reachable = state.facts.find((fact) => fact.nodeId === READ.id);
    expect(reachable?.code).toBe("state.reachableRoute");
    expect(reachable?.params.permission).toBe("todos:read");
    expect(state.badges.get(STATS_ROUTE.id)?.text).toBe("PUB");
  });

  it("expands a wildcard role to every declared permission and shows it in the banner", () => {
    const state = buildReachLensState(CONFIG, VIEW, "admin", () => {});
    const flagged = new Set(state.highlight);
    expect(flagged.has(READ.id)).toBe(true);
    expect(flagged.has(WRITE.id)).toBe(true);
    expect(flagged.has(STATS_ROUTE.id)).toBe(true);
    expect(state.contextKey).toBe("projectGraph.surface.state.wildcardRole");
    expect(t("projectGraph.surface.state.wildcardRole", state.params)).toContain("admin");
  });

  it("reports a permission no role holds as unknown, naming it", () => {
    const view: ProjectGraphView = { ...VIEW, nodes: [...VIEW.nodes, BILLING] };
    const state = buildReachLensState(CONFIG, view, "member", () => {});
    const fact = state.facts.find((entry) => entry.nodeId === BILLING.id);
    expect(fact?.code).toBe("state.undeclaredPermission");
    expect(fact?.params.permission).toBe("billing:read");
    expect(new Set(state.highlight).has(BILLING.id)).toBe(true);
    expect(state.totals?.count).toBe(2);
  });

  it("preselects the default role and falls back to the first one", () => {
    expect(defaultReachRole(CONFIG)).toBe("member");
    const state = buildReachLensState(CONFIG, VIEW, null, () => {});
    expect(state.picker?.value).toBe("member");
    expect(state.picker?.options).toEqual(["admin", "member"]);
    const stale = buildReachLensState(CONFIG, VIEW, "gone", () => {});
    expect(stale.picker?.value).toBe("member");
  });

  it("explains a config with no roles and a role that reaches nothing", () => {
    const none = buildReachLensState(
      { roles: {}, permissions: [], defaultRole: null },
      VIEW,
      null,
      () => {},
    );
    expect(none.emptyKey).toBe("projectGraph.surface.state.noRoles");
    const blocked = buildReachLensState(
      {
        roles: { guest: [], member: ["todos:read"] },
        permissions: ["todos:read"],
        defaultRole: "guest",
      },
      { ...VIEW, nodes: [READ] },
      null,
      () => {},
    );
    expect(blocked.emptyKey).toBe("projectGraph.surface.state.noReach");
  });

  it("marks an elevated route without moving any node", () => {
    const elevated = routeNode(
      "GET",
      "/api/system",
      ["todos:read"],
      [
        {
          kind: "sudo",
          operation: "sudo",
          tables: ["todos"],
          source: { file: "server/routes/api/system.ts", line: 1 },
          unknown: [],
        },
      ],
    );
    const view: ProjectGraphView = { ...VIEW, nodes: [...VIEW.nodes, elevated] };
    const key = surfaceLayoutKey(view);
    const before = view.nodes.map((node) => [node.id, node.position]);
    const state = buildReachLensState(CONFIG, view, "member", () => {});
    expect(codesOf(state)).toContain("state.elevatedRoute");
    expect(state.badges.get(elevated.id)?.text).toBe("SUDO");
    expect(view.nodes.map((node) => [node.id, node.position])).toEqual(before);
    expect(surfaceLayoutKey(view)).toBe(key);
  });
});
