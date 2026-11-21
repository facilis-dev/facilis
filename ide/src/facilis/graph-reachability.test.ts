// The closure contract (issue #66 criterion 1): every edge kind, elevated edges and view-base
// links, a schema cycle, directed semantics and determinism — over the REAL visible view
// (buildProjectGraphView), so hidden kinds and filters are honoured exactly as the canvas sees
// them. The fixture reuses graph-model.test-fixtures.ts and spells out one edge of every kind.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "./graph-model";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
  workflowNode,
} from "./graph-model.test-fixtures";
import { reachabilityClosure } from "./graph-reachability";

const P1 = pageNode("src/pages/home.tsx");
const P2 = pageNode("src/pages/about.tsx");
const R1 = routeNode("GET", "/api/items");
const R2 = routeNode("POST", "/api/items");
const A = tableNode("items");
const B = tableNode("orders");
const C = tableNode("customers");
const V = viewNode("active_items", { tables: ["items"] });
const W = workflowNode("restock");
const ISLAND = tableNode("island");

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

// Every kind appears; A ↔ B is a schema cycle (fk one way, relation the other); R2 reaches B
// through an audited elevation; V sits over C through a view-base link; W and ISLAND have no
// edges at all (the analyzer draws workflow cards unconnected today).
const EDGES: readonly GraphEdge[] = [
  edge("pr1", "page-route", P1.id, R1.id),
  edge("pl1", "page-link", P1.id, P2.id),
  edge("rt1", "route-table", R1.id, A.id),
  edge("rt2", "route-table", R2.id, B.id, true),
  edge("fk1", "fk", A.id, B.id),
  edge("rel1", "relation", B.id, A.id),
  edge("fk2", "fk", B.id, C.id),
  edge("rv1", "route-view", R1.id, V.id),
  edge("vb1", "view-base", V.id, C.id),
  edge("self", "fk", A.id, A.id),
];

const NODES = [P1, P2, R1, R2, A, B, C, V, W, ISLAND];

function viewOf(hiddenEdgeKinds: readonly GraphEdge["kind"][] = []) {
  return buildProjectGraphView({ graph: graphOf(NODES, EDGES), hiddenEdgeKinds });
}

const ids = (closure: ReturnType<typeof reachabilityClosure>): string[] =>
  closure === null ? [] : [...closure.nodeIds];

describe("reachabilityClosure", () => {
  it("returns null for an id the visible view does not have", () => {
    expect(reachabilityClosure(viewOf(), "table:ghost")).toBeNull();
  });

  it("closes a schema cycle without duplicates and includes every connected kind", () => {
    const closure = reachabilityClosure(viewOf(), A.id);
    // V joins through the undirected fk chain B ↔ C plus the view-base link V → C (upstream).
    expect(ids(closure)).toEqual([P1.id, R1.id, R2.id, A.id, B.id, C.id, V.id].toSorted());
    // The cycle A ↔ B is walked once; the self-loop adds no node.
    expect(new Set(closure?.nodeIds).size).toBe(closure?.nodeIds.length);
  });

  it("keeps directed semantics: a co-writer of the same table is not in the closure", () => {
    // P1 reaches R1 → A; R2 also writes B, but nothing connects R2 to P1's downstream cone.
    const closure = reachabilityClosure(viewOf(), P1.id);
    expect(ids(closure)).toEqual([P1.id, P2.id, R1.id, A.id, B.id, C.id, V.id].toSorted());
    expect(ids(closure)).not.toContain(R2.id);
  });

  it("walks upstream: selecting a table names the pages and routes that reach it", () => {
    const closure = reachabilityClosure(viewOf(), C.id);
    expect(ids(closure)).toContain(R1.id);
    expect(ids(closure)).toContain(P1.id);
    expect(ids(closure)).toContain(V.id);
    // P2 is reached BY P1, not a reacher of C: the upstream walk never follows page-link forward.
    expect(ids(closure)).not.toContain(P2.id);
  });

  it("traverses elevated edges like their kind", () => {
    const closure = reachabilityClosure(viewOf(), R2.id);
    expect(ids(closure)).toEqual([R2.id, A.id, B.id, C.id].toSorted());
    expect(closure?.edgeIds).toContain("rt2");
  });

  it("includes view-base links in both directions", () => {
    const fromView = reachabilityClosure(viewOf(), V.id);
    expect(ids(fromView)).toContain(C.id);
    const fromBase = reachabilityClosure(viewOf(), C.id);
    expect(ids(fromBase)).toContain(V.id);
    expect(fromBase?.edgeIds).toContain("vb1");
  });

  it("treats fk and relation as undirected schema links", () => {
    // From B the fk A→B is walked backwards and the relation B→A forwards: both join.
    const closure = reachabilityClosure(viewOf(), B.id);
    expect(ids(closure)).toContain(A.id);
    expect(closure?.edgeIds).toEqual(expect.arrayContaining(["fk1", "rel1"]));
  });

  it("terminates on a purely directed cycle too", () => {
    const p = pageNode("src/pages/a.tsx");
    const q = pageNode("src/pages/b.tsx");
    const r = pageNode("src/pages/c.tsx");
    const cycleView = buildProjectGraphView({
      graph: graphOf(
        [p, q, r],
        [
          edge("c1", "page-link", p.id, q.id),
          edge("c2", "page-link", q.id, r.id),
          edge("c3", "page-link", r.id, p.id),
        ],
      ),
    });
    expect(ids(reachabilityClosure(cycleView, p.id))).toEqual([p.id, q.id, r.id].toSorted());
  });

  it("lists exactly the edges whose two endpoints are in the closure", () => {
    const closure = reachabilityClosure(viewOf(), A.id);
    // Only pl1 leaves the closure (P2 is outside); the self-loop stays (endpoint inside).
    expect(closure?.edgeIds).toEqual(
      ["pr1", "rt1", "rt2", "fk1", "rel1", "fk2", "rv1", "vb1", "self"].toSorted(),
    );
  });

  it("isolates an unconnected node to itself", () => {
    expect(reachabilityClosure(viewOf(), W.id)).toEqual({ nodeIds: [W.id], edgeIds: [] });
    expect(reachabilityClosure(viewOf(), ISLAND.id)).toEqual({
      nodeIds: [ISLAND.id],
      edgeIds: [],
    });
  });

  it("is deterministic regardless of edge order", () => {
    const shuffled = buildProjectGraphView({
      graph: graphOf(NODES.toReversed(), EDGES.toReversed()),
    });
    expect(reachabilityClosure(shuffled, A.id)).toEqual(reachabilityClosure(viewOf(), A.id));
  });

  it("respects hidden edge kinds: the closure runs over the visible view only", () => {
    const closure = reachabilityClosure(viewOf(["fk", "relation"]), A.id);
    // Without the schema links the cone shrinks to what route-table/page-route still connect.
    expect(ids(closure)).toEqual([P1.id, R1.id, A.id].toSorted());
    expect(closure?.edgeIds).toEqual(["pr1", "rt1"].toSorted());
  });

  it("includes the start node in its own closure", () => {
    const closure = reachabilityClosure(viewOf(), P2.id);
    expect(ids(closure)).toEqual([P1.id, P2.id].toSorted());
    expect(closure?.edgeIds).toEqual(["pl1"]);
  });
});
