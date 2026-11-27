// The runtime lens's fact mapping (D-225, Q18): samples become normalised state facts and
// draw-only badges, never layout input. Pure inputs, so the node mapping, the thresholds and
// the empty state are all unit-testable without a preview.

import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import type { RouteRuntimeMetrics } from "../runtime-metrics";
import { surfaceLayoutKey } from "./positions.ts";
import { SLOW_ROUTE_P95_MS, buildRuntimeLensState, runtimeRouteTemplates } from "./runtime-lens.ts";

const STATS = {
  pages: 0,
  routes: 2,
  tables: 0,
  views: 0,
  workflows: 0,
  edges: 0,
  hiddenEdges: 0,
  hiddenNodes: 0,
  matches: 0,
  unknownNodes: 0,
  pageLinks: 0,
  elevatedEdges: 0,
};

function routeNode(method: "GET" | "POST", path: string) {
  return {
    id: "route:" + method + " " + path,
    kind: "route" as const,
    label: method + " " + path,
    sourceFile: "server/routes" + path + ".ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "route" as const,
      method,
      path,
      permission: [],
      wrapper: "valid" as const,
      description: null,
      input: { body: false, form: false, query: false, params: false },
      pathParams: [],
      dbTables: [],
      elevations: [],
      unknown: false,
    },
  };
}

const VIEW: ProjectGraphView = {
  nodes: [routeNode("GET", "/api/todos/{id}"), routeNode("POST", "/api/todos")],
  edges: [],
  stats: STATS,
};

function row(
  method: "GET" | "POST",
  route: string,
  overrides: Partial<RouteRuntimeMetrics> = {},
): RouteRuntimeMetrics {
  return {
    route,
    method,
    count: 4,
    errors: 0,
    clientErrors: 0,
    aborted: 0,
    p50Ms: 5,
    p95Ms: 20,
    ...overrides,
  };
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("runtime lens state", () => {
  it("maps method+template to the route node and aggregates the banner", () => {
    const state = buildRuntimeLensState(
      [
        row("GET", "/api/todos/{id}", { count: 5, errors: 2, p95Ms: 100 }),
        row("POST", "/api/todos", { count: 3, errors: 0, p95Ms: 900 }),
        row("GET", "/api/assets/logo.svg", { count: 9 }),
      ],
      VIEW,
    );
    expect(state.totals).toMatchObject({ count: 8, params: { errors: 2 } });
    expect(state.facts.map((fact) => [fact.nodeId, fact.code])).toEqual([
      ["route:GET /api/todos/{id}", "state.routeErrors"],
      ["route:POST /api/todos", "state.slowRoute"],
    ]);
    expect(state.badges.get("route:GET /api/todos/{id}")?.text).toBe(
      t("projectGraph.surface.state.badge", { requests: 5, errors: 2 }),
    );
    expect(state.badges.get("route:POST /api/todos")?.colorToken).toBe("--warning");
    expect(state.emptyKey).toBeNull();
    expect(state.contextKey).toBe("projectGraph.surface.state.window");
  });

  it("reports no traffic as an explicit empty state with no bogus facts", () => {
    const state = buildRuntimeLensState([], VIEW);
    expect(state.facts).toEqual([]);
    expect(state.badges.size).toBe(0);
    expect(state.totals).toMatchObject({ count: 0, params: { errors: 0 } });
    expect(state.emptyKey).toBe("projectGraph.surface.state.noTraffic");
  });

  it("keeps the slow threshold and the badge colour in one place", () => {
    const state = buildRuntimeLensState(
      [row("GET", "/api/todos/{id}", { p95Ms: SLOW_ROUTE_P95_MS })],
      VIEW,
    );
    expect(state.facts[0]?.params).toEqual({
      p95: SLOW_ROUTE_P95_MS,
      threshold: SLOW_ROUTE_P95_MS,
    });
    expect(state.badges.get("route:GET /api/todos/{id}")?.colorToken).toBe("--warning");
  });

  it("never touches the layout fingerprint", () => {
    const key = surfaceLayoutKey(VIEW);
    buildRuntimeLensState([row("GET", "/api/todos/{id}")], VIEW);
    expect(surfaceLayoutKey(VIEW)).toBe(key);
  });

  it("derives the enable list from the drawn templates, sorted and unique", () => {
    expect(runtimeRouteTemplates(VIEW)).toEqual(["/api/todos", "/api/todos/{id}"]);
    expect(runtimeRouteTemplates(null)).toEqual([]);
  });

  it("re-translates the badge on a locale switch", () => {
    const english = buildRuntimeLensState([row("GET", "/api/todos/{id}")], VIEW).badges.get(
      "route:GET /api/todos/{id}",
    )?.text;
    setLocale("it");
    const italian = buildRuntimeLensState([row("GET", "/api/todos/{id}")], VIEW).badges.get(
      "route:GET /api/todos/{id}",
    )?.text;
    expect(italian).not.toBe(english);
    expect(italian).toContain("rich");
  });
});
