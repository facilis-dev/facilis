// The contract lens's audit semantics (issue #69): the counters must equal an independent scan
// of the same nodes, the filters toggle like the stats ribbon's, and the LOD threshold is pure.
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "@facilis.dev/analyze";
import {
  AUDIT_FILTER_IDS,
  CONTRACT_COMPACT_ZOOM,
  auditFilterActive,
  contractLod,
  countAudit,
  isProtectedRoute,
  nodeAuditFlags,
  nodeMatchesAudit,
  routeInputPresent,
  toggleAuditFilter,
} from "./graph-contract";
import type { ProjectGraphNode, RouteGraphData, TableGraphData } from "./graph-types";

const NO_INPUT = { body: false, form: false, query: false, params: false };

function routeData(overrides: Partial<RouteGraphData> = {}): RouteGraphData {
  return {
    kind: "route",
    method: "GET",
    path: "/api/todos",
    permission: ["todos:read"],
    wrapper: "valid",
    description: null,
    input: { ...NO_INPUT, query: true },
    pathParams: [],
    dbTables: ["todos"],
    elevations: [],
    unknown: false,
    ...overrides,
  };
}

function routeNode(id: string, overrides: Partial<RouteGraphData> = {}): ProjectGraphNode {
  return {
    id,
    kind: "route",
    label: id,
    sourceFile: null,
    position: { x: 0, y: 0 },
    data: routeData(overrides),
    matched: true,
    collapsed: false,
  };
}

function tableNode(id: string, unknown: boolean): ProjectGraphNode {
  const data: TableGraphData = {
    kind: "table",
    table: id,
    columns: [],
    rlsEnabled: !unknown,
    framework: false,
    scope: null,
    policies: [],
    unknown,
  };
  return {
    id,
    kind: "table",
    label: id,
    sourceFile: null,
    position: { x: 0, y: 0 },
    data,
    matched: true,
    collapsed: false,
  };
}

const warning: Diagnostic = {
  code: "route-direct-db",
  severity: "warning",
  message: "direct db",
  source: { file: "server/routes/todos.get.ts", line: 5 },
};
const error: Diagnostic = {
  code: "route-wrapper",
  severity: "error",
  message: "bad wrapper",
  source: { file: "server/routes/todos.get.ts", line: 1 },
};

describe("isProtectedRoute / routeInputPresent", () => {
  it("counts a route as protected only with a valid wrapper AND a required permission", () => {
    expect(isProtectedRoute(routeData())).toBe(true);
    expect(isProtectedRoute(routeData({ permission: [] }))).toBe(false);
    expect(isProtectedRoute(routeData({ wrapper: "invalid" }))).toBe(false);
    expect(isProtectedRoute(routeData({ wrapper: "unknown" }))).toBe(false);
    expect(isProtectedRoute(routeData({ unknown: true }))).toBe(false);
  });

  it("detects any input schema, including form and params", () => {
    expect(routeInputPresent(NO_INPUT)).toBe(false);
    expect(routeInputPresent({ ...NO_INPUT, body: true })).toBe(true);
    expect(routeInputPresent({ ...NO_INPUT, form: true })).toBe(true);
    expect(routeInputPresent({ ...NO_INPUT, query: true })).toBe(true);
    expect(routeInputPresent({ ...NO_INPUT, params: true })).toBe(true);
  });
});

describe("nodeAuditFlags", () => {
  it("never scores an unknown route as missing input: unknown is its own counter", () => {
    const unknownRoute = routeNode("r", { unknown: true, input: NO_INPUT });
    const flags = nodeAuditFlags(unknownRoute, []);
    expect(flags.missingInput).toBe(false);
    expect(flags.unknown).toBe(true);
    expect(flags.protected).toBe(false);
  });

  it("flags a known route without any input schema as missing input", () => {
    const flags = nodeAuditFlags(routeNode("r", { input: NO_INPUT }), []);
    expect(flags.missingInput).toBe(true);
    expect(flags.unknown).toBe(false);
  });

  it("flags attached diagnostics and leaves pages out of the unknown counter", () => {
    expect(nodeAuditFlags(routeNode("r"), [warning]).diagnostics).toBe(true);
    expect(nodeAuditFlags(routeNode("r"), []).diagnostics).toBe(false);
    const page: ProjectGraphNode = {
      ...routeNode("p"),
      kind: "page",
      data: {
        kind: "page",
        pagePath: "/x",
        pageKind: "page",
        callCount: 0,
        routePaths: [],
        preview: null,
      },
    };
    expect(nodeAuditFlags(page, []).unknown).toBe(false);
  });
});

describe("countAudit", () => {
  const nodes = [
    routeNode("route:GET /a"),
    routeNode("route:GET /b", { permission: [] }),
    routeNode("route:POST /c", { input: NO_INPUT }),
    routeNode("route:GET /d", { unknown: true, input: NO_INPUT }),
    tableNode("table:todos", false),
    tableNode("table:unknown", true),
  ];
  const byNode = new Map<string, readonly Diagnostic[]>([
    ["route:GET /a", [error]],
    ["table:todos", [warning, warning]],
  ]);

  it("equals an independent scan of the same nodes", () => {
    // The expected values are spelled out from the fixture, not computed by the module.
    expect(countAudit(nodes, byNode)).toEqual({
      protected: 2, // /a and /c: valid wrapper + permission; /b public, /d unknown
      missingInput: 1, // /c only; /d is unknown, not absent
      unknown: 2, // /d and table:unknown
      diagnostics: 3, // 1 on /a + 2 on table:todos
    });
  });

  it("returns all zeros for an empty graph", () => {
    expect(countAudit([], new Map())).toEqual({
      protected: 0,
      missingInput: 0,
      unknown: 0,
      diagnostics: 0,
    });
  });

  it("counts only the diagnostics attached to the scanned nodes", () => {
    const drawn = nodes.filter((node) => node.id !== "table:todos");
    expect(countAudit(drawn, byNode).diagnostics).toBe(1);
  });
});

describe("toggleAuditFilter / nodeMatchesAudit", () => {
  it("toggles counters independently, like the stats ribbon's kind filter", () => {
    expect(toggleAuditFilter([], "unknown")).toEqual(["unknown"]);
    expect(toggleAuditFilter(["unknown"], "diagnostics")).toEqual(["unknown", "diagnostics"]);
    expect(toggleAuditFilter(["unknown", "diagnostics"], "unknown")).toEqual(["diagnostics"]);
    expect(toggleAuditFilter(["diagnostics"], "diagnostics")).toEqual([]);
    expect(auditFilterActive(["unknown"], "unknown")).toBe(true);
    expect(auditFilterActive([], "unknown")).toBe(false);
  });

  it("matches the union of the active counters; the empty set filters nothing", () => {
    const unknownTable = tableNode("table:unknown", true);
    const plainRoute = routeNode("route:GET /a");
    expect(nodeMatchesAudit(unknownTable, [], [])).toBe(true);
    expect(nodeMatchesAudit(plainRoute, [], [])).toBe(true);
    expect(nodeMatchesAudit(unknownTable, [], ["unknown"])).toBe(true);
    expect(nodeMatchesAudit(plainRoute, [], ["unknown"])).toBe(false);
    expect(nodeMatchesAudit(plainRoute, [warning], ["unknown", "diagnostics"])).toBe(true);
    expect(nodeMatchesAudit(unknownTable, [warning], ["unknown", "diagnostics"])).toBe(true);
  });

  it("exposes the four counters in a stable order", () => {
    expect(AUDIT_FILTER_IDS).toEqual(["protected", "missingInput", "unknown", "diagnostics"]);
  });
});

describe("contractLod", () => {
  it("compacts below the threshold and keeps full badges at or above it", () => {
    expect(contractLod(1)).toBe("full");
    expect(contractLod(CONTRACT_COMPACT_ZOOM)).toBe("full");
    expect(contractLod(CONTRACT_COMPACT_ZOOM - 0.001)).toBe("compact");
    expect(contractLod(0.05)).toBe("compact");
  });
});
