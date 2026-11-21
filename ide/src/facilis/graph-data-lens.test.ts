// The data lens's pure contract (issue #70): the ribbon counters equal the visible-view scan
// (criterion 4), the scope classification keeps unknown first-class, and the FK neighbourhood
// is deterministic over a fixture WITH A CYCLE (criterion 3) — reusing graph-reachability.ts.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "./graph-model";
import { graphOf, pageNode, routeNode, tableNode, viewNode } from "./graph-model.test-fixtures";
import {
  DATA_COMPACT_ZOOM,
  countDataLens,
  dataLod,
  fkNeighbourhood,
  tableScopeState,
} from "./graph-data-lens";
import type { TableGraphData } from "./graph-types";

const P1 = pageNode("src/pages/home.tsx");
const R1 = routeNode("GET", "/api/items");
const R2 = routeNode("POST", "/api/items");
// A ↔ B is a schema cycle (fk one way, relation the other); B → C extends the mesh.
const A = tableNode("items", { scope: { column: "tenantId", kind: "tenant" } });
const B = tableNode("orders", { scope: { column: "ownerId", kind: "owner" } });
const C = tableNode("customers"); // readable, no scope → the unscoped counter
const U = tableNode("unreadable", { unknown: true }); // unreadable ≠ unscoped
const ISLAND = tableNode("island");
const V_INVOKER = viewNode("active_items", { tables: ["items"] });
const V_DEFINER = viewNode("audit_items", {
  tables: ["items"],
  permission: "items:read",
  access: "definer",
});
const V_UNKNOWN = viewNode("broken_view", { access: null });

const edge = (
  id: string,
  kind: GraphEdge["kind"],
  source: string,
  target: string,
  elevated = false,
): GraphEdge => ({
  id,
  kind,
  source,
  target,
  label: null,
  ...(elevated ? { access: "elevated" as const } : {}),
});

const EDGES: readonly GraphEdge[] = [
  edge("pr1", "page-route", P1.id, R1.id),
  edge("rt1", "route-table", R1.id, A.id),
  edge("rt2", "route-table", R2.id, B.id, true),
  edge("rt3", "route-view", R2.id, V_DEFINER.id, true),
  edge("fk1", "fk", A.id, B.id),
  edge("rel1", "relation", B.id, A.id),
  edge("fk2", "fk", B.id, C.id),
  edge("vb1", "view-base", V_INVOKER.id, A.id),
  edge("self", "fk", A.id, A.id),
];

const NODES = [P1, R1, R2, A, B, C, U, ISLAND, V_INVOKER, V_DEFINER, V_UNKNOWN];

function viewOf(hiddenEdgeKinds: readonly GraphEdge["kind"][] = []) {
  return buildProjectGraphView({ graph: graphOf(NODES, EDGES), hiddenEdgeKinds });
}

describe("countDataLens (criterion 4: counters equal the scan)", () => {
  it("counts unscoped tables, definer views and elevated edges over the visible view", () => {
    const view = viewOf();
    const counts = countDataLens(view.nodes, view.edges);
    // customers + island are readable and unscoped; items/orders scoped, unreadable unknown.
    expect(counts.unscopedTables).toBe(2);
    expect(counts.definerViews).toBe(1); // audit_items; broken_view's null access is unknown
    expect(counts.elevatedEdges).toBe(2); // rt2 + rt3
    // The elevated counter uses the same predicate as the stats ribbon, over the same view.
    expect(counts.elevatedEdges).toBe(view.stats.elevatedEdges);
  });

  it("equals a manual node/edge scan of the same view", () => {
    const view = viewOf();
    const unscoped = view.nodes.filter(
      (node) => node.data.kind === "table" && !node.data.unknown && node.data.scope === null,
    ).length;
    const definer = view.nodes.filter(
      (node) => node.data.kind === "view" && node.data.access === "definer",
    ).length;
    const elevated = view.edges.filter((edge) => edge.access === "elevated").length;
    expect(countDataLens(view.nodes, view.edges)).toEqual({
      unscopedTables: unscoped,
      definerViews: definer,
      elevatedEdges: elevated,
    });
  });

  it("shrinks with the visible view when an edge kind is hidden", () => {
    const view = viewOf(["route-table", "route-view"]);
    const counts = countDataLens(view.nodes, view.edges);
    expect(counts.elevatedEdges).toBe(0);
    expect(counts.elevatedEdges).toBe(view.stats.elevatedEdges);
    // Node counters are untouched: hiding edges never removes cards.
    expect(counts.unscopedTables).toBe(2);
    expect(counts.definerViews).toBe(1);
  });

  it("never scores an unreadable table as unscoped (epic rule 5)", () => {
    const view = buildProjectGraphView({ graph: graphOf([U], []) });
    expect(countDataLens(view.nodes, view.edges).unscopedTables).toBe(0);
  });
});

describe("tableScopeState", () => {
  const table = (overrides: Partial<TableGraphData> = {}): TableGraphData => ({
    kind: "table",
    table: "t",
    columns: [],
    rlsEnabled: true,
    framework: false,
    scope: null,
    policies: [],
    unknown: false,
    ...overrides,
  });

  it("keeps tenant, owner, none and unknown pairwise distinct", () => {
    const states = [
      tableScopeState(table({ scope: { column: "tenantId", kind: "tenant" } })),
      tableScopeState(table({ scope: { column: "ownerId", kind: "owner" } })),
      tableScopeState(table()),
      tableScopeState(table({ unknown: true })),
    ];
    expect(states).toEqual(["tenant", "owner", "none", "unknown"]);
    expect(new Set(states).size).toBe(4);
  });

  it("an unreadable table with a stale scope fact still reads unknown", () => {
    expect(tableScopeState(table({ unknown: true, scope: { column: "x", kind: "tenant" } }))).toBe(
      "unknown",
    );
  });
});

describe("fkNeighbourhood (criterion 3: deterministic over a cycle)", () => {
  it("closes the schema cycle undirected and excludes every non-schema edge", () => {
    const view = viewOf();
    const closure = fkNeighbourhood(view, A.id);
    // The cycle A ↔ B plus B → C; routes, pages and views stay outside even though they
    // touch the mesh through route-table/view-base edges.
    expect(closure?.nodeIds).toEqual([A.id, B.id, C.id].toSorted());
    expect(closure?.edgeIds).toEqual(["fk1", "fk2", "rel1", "self"].toSorted());
  });

  it("reaches the whole mesh from any member of the cycle", () => {
    const view = viewOf();
    expect(fkNeighbourhood(view, B.id)?.nodeIds).toEqual([A.id, B.id, C.id].toSorted());
    expect(fkNeighbourhood(view, C.id)?.nodeIds).toEqual([A.id, B.id, C.id].toSorted());
  });

  it("is deterministic regardless of node and edge order", () => {
    const shuffled = buildProjectGraphView({
      graph: graphOf(NODES.toReversed(), EDGES.toReversed()),
    });
    expect(fkNeighbourhood(shuffled, A.id)).toEqual(fkNeighbourhood(viewOf(), A.id));
  });

  it("isolates an unconnected table to itself and degrades a ghost id to null", () => {
    const view = viewOf();
    expect(fkNeighbourhood(view, ISLAND.id)).toEqual({ nodeIds: [ISLAND.id], edgeIds: [] });
    expect(fkNeighbourhood(view, "table:ghost")).toBeNull();
  });

  it("respects hidden schema kinds: the neighbourhood runs over the visible view", () => {
    const view = viewOf(["relation"]);
    // rel1 is hidden, but fk1 still connects A ↔ B undirected; the cycle stays closed.
    expect(fkNeighbourhood(view, A.id)?.nodeIds).toEqual([A.id, B.id, C.id].toSorted());
    const noSchema = viewOf(["fk", "relation"]);
    expect(fkNeighbourhood(noSchema, A.id)).toEqual({ nodeIds: [A.id], edgeIds: [] });
  });
});

describe("dataLod", () => {
  it("compacts below the threshold and keeps full labels at or above it", () => {
    expect(dataLod(DATA_COMPACT_ZOOM - 0.01)).toBe("compact");
    expect(dataLod(DATA_COMPACT_ZOOM)).toBe("full");
    expect(dataLod(1)).toBe("full");
    expect(dataLod(0.05)).toBe("compact");
  });
});
