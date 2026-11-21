// The chip's edge count is derived from the visible view (issue #60, epic rule 5): each edge
// counts once per endpoint and a self-loop once; an unconnected node reads zero, never a guess.
// Edge-kind isolation (issue #63) is opacity only: cards no isolated edge touches recede to 10%,
// notes always recede, and positions/selection never move (epic rule 2).
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
import { describe, expect, it } from "vitest";
import type { Diagnostic, GraphEdge, GraphEdgeKind } from "@facilis.dev/analyze";
import { fkNeighbourhood } from "@/facilis/graph-data-lens";
import {
  INACTIVE_TURN_DIFF,
  type GraphTurnDiff,
  type TurnOverlay,
} from "@/facilis/graph-turn-diff";
import { buildProjectGraphView, type ProjectGraphView } from "@/facilis/graph-model";
import { reachabilityClosure, type GraphReachability } from "@/facilis/graph-reachability";
import {
  GET,
  PAGE,
  TODOS,
  WORKFLOW,
  graphOf,
  routeNode,
  tableNode,
} from "@/facilis/graph-model.test-fixtures";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import { HUB_NODE_TYPE } from "./ProjectGraphHubNode";
import { TURN_NODE_TYPE, type ProjectTurnFlowNode } from "./ProjectGraphTurnNode";
import type { ProjectAnalysisFlowNode, ProjectFlowNode } from "./ProjectGraphNodes";
import { buildProjectGraphFlowNodes, type ProjectFlowDataState } from "./project-graph-flow-nodes";

const EDGES: GraphEdge[] = [
  { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
  { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
  { id: "fk:self", kind: "fk", source: TODOS.id, target: TODOS.id, label: null },
];

const NOOP = () => {};

function dataOf(id: string) {
  const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, WORKFLOW], EDGES) });
  const nodes = buildProjectGraphFlowNodes({
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    drill: null,
    hubIsolation: null,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });
  const node = nodes.find((entry) => entry.id === id);
  // Notes, frames, hubs and the details satellite carry their own data shapes; only analysis
  // cards have counts.
  if (
    node === undefined ||
    node.type === "note" ||
    node.type === DETAILS_NODE_TYPE ||
    node.type === CLUSTER_NODE_TYPE ||
    node.type === HUB_NODE_TYPE ||
    node.type === TURN_NODE_TYPE
  )
    throw new Error("missing node " + id);
  return node.data;
}

describe("buildProjectGraphFlowNodes edgeCount", () => {
  it("counts each edge once per endpoint and a self-loop once", () => {
    expect(dataOf(PAGE.id).edgeCount).toBe(1);
    expect(dataOf(GET.id).edgeCount).toBe(2);
    expect(dataOf(TODOS.id).edgeCount).toBe(2);
  });

  it("reads zero for an unconnected node", () => {
    expect(dataOf(WORKFLOW.id).edgeCount).toBe(0);
  });
});

const VIEW = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, WORKFLOW], EDGES) });

function buildNodes(isolatedEdgeKinds: readonly GraphEdgeKind[], selectedNodeId: string | null) {
  return buildProjectGraphFlowNodes({
    view: VIEW,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds,
    drill: null,
    hubIsolation: null,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });
}

function cardData(nodes: readonly ProjectFlowNode[], id: string) {
  const node = nodes.find((entry) => entry.id === id);
  if (
    node === undefined ||
    node.type === DETAILS_NODE_TYPE ||
    node.type === CLUSTER_NODE_TYPE ||
    node.type === HUB_NODE_TYPE
  )
    throw new Error("missing " + id);
  return node.data;
}

describe("buildProjectGraphFlowNodes isolation", () => {
  it("marks nothing isolated when no kind is isolated", () => {
    const nodes = buildNodes([], null);
    expect(
      nodes.every(
        (node) =>
          node.type !== DETAILS_NODE_TYPE &&
          node.type !== CLUSTER_NODE_TYPE &&
          node.data.isolated === false,
      ),
    ).toBe(true);
  });

  it("dims only the cards no isolated edge touches, keeping positions and selection", () => {
    const nodes = buildNodes(["fk"], WORKFLOW.id);
    // The fk self-loop touches only TODOS; every other card recedes.
    expect(cardData(nodes, TODOS.id).isolated).toBe(false);
    expect(cardData(nodes, PAGE.id).isolated).toBe(true);
    expect(cardData(nodes, GET.id).isolated).toBe(true);
    expect(cardData(nodes, WORKFLOW.id).isolated).toBe(true);
    // Opacity only: positions and selection survive the isolation untouched (epic rule 2).
    const plain = buildNodes([], WORKFLOW.id);
    for (const node of nodes) {
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      expect(node.selected).toBe(before?.selected);
    }
    expect(nodes).toHaveLength(5);
  });

  it("recedes notes with the graph while isolation is active", () => {
    expect(cardData(buildNodes(["fk"], null), "note-1").isolated).toBe(true);
    expect(cardData(buildNodes([], null), "note-1").isolated).toBe(false);
  });

  it("keeps every connected card bright when all kinds are isolated; notes still recede", () => {
    const nodes = buildNodes(["page-route", "route-table", "fk"], null);
    expect(cardData(nodes, PAGE.id).isolated).toBe(false);
    expect(cardData(nodes, GET.id).isolated).toBe(false);
    expect(cardData(nodes, TODOS.id).isolated).toBe(false);
    // An unconnected card is touched by no isolated edge, so it still recedes.
    expect(cardData(nodes, WORKFLOW.id).isolated).toBe(true);
    expect(cardData(nodes, "note-1").isolated).toBe(true);
  });
});

// The flow-node mapping for clusters (issue #62): compound children carry parentId + extent
// and frame-relative positions, frames are non-draggable boxes, and a drill dims everything
// outside the drilled cluster without moving anything (epic #56 rule 2).

const CLUSTER_GRAPH = graphOf([PAGE, GET, TODOS], EDGES);

function clusterInputs(
  view: ReturnType<typeof buildProjectGraphView>,
  overrides: Partial<Parameters<typeof buildProjectGraphFlowNodes>[0]> = {},
) {
  return {
    view,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    drill: null,
    hubIsolation: null,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
    ...overrides,
  };
}

describe("buildProjectGraphFlowNodes clusters (issue #62)", () => {
  const view = buildProjectGraphView({
    graph: CLUSTER_GRAPH,
    clusters: { enabled: true, collapsed: [] },
  });

  it("maps every cluster to a non-draggable frame node of the reserved size", () => {
    const nodes = buildProjectGraphFlowNodes(clusterInputs(view));
    const frames = nodes.filter((node) => node.type === CLUSTER_NODE_TYPE);
    expect(frames).toHaveLength(view.clusters.length);
    for (const frame of frames) {
      const cluster = view.clusters.find((entry) => entry.id === frame.id);
      expect(frame.draggable).toBe(false);
      expect(frame.position).toEqual(cluster?.position);
      expect(frame.style).toEqual({ width: cluster?.size.width, height: cluster?.size.height });
    }
  });

  it("members become compound children with frame-relative positions", () => {
    const nodes = buildProjectGraphFlowNodes(clusterInputs(view));
    for (const cluster of view.clusters) {
      for (const id of cluster.nodeIds) {
        const child = nodes.find((node) => node.id === id);
        const model = view.nodes.find((node) => node.id === id);
        expect(child?.parentId).toBe(cluster.id);
        expect(child?.extent).toBe("parent");
        expect(child?.position).toEqual({
          x: (model?.position.x ?? 0) - cluster.position.x,
          y: (model?.position.y ?? 0) - cluster.position.y,
        });
      }
    }
  });

  it("a drill dims outsiders and brightens the drilled cluster, positions unchanged", () => {
    const target = view.clusters[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    const drill = { clusterId: target.id, nodeIds: new Set(target.nodeIds) };
    const plain = buildProjectGraphFlowNodes(clusterInputs(view));
    const drilled = buildProjectGraphFlowNodes(clusterInputs(view, { drill }));
    for (const node of drilled) {
      if (node.type === DETAILS_NODE_TYPE) continue;
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      const inside = node.id === target.id || target.nodeIds.includes(node.id);
      expect(node.data.focused).toBe(inside);
    }
  });

  it("grouping off keeps absolute positions and no parent", () => {
    const flat = buildProjectGraphView({ graph: CLUSTER_GRAPH });
    const nodes = buildProjectGraphFlowNodes(clusterInputs(flat));
    expect(nodes.some((node) => node.type === CLUSTER_NODE_TYPE)).toBe(false);
    for (const node of nodes) {
      expect(node.parentId).toBeUndefined();
      const model = flat.nodes.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(model?.position);
    }
  });

  it("a collapsed cluster maps its super-node and no children", () => {
    const collapsedView = buildProjectGraphView({
      graph: CLUSTER_GRAPH,
      clusters: { enabled: true, collapsed: ["cluster:api/api"] },
    });
    const nodes = buildProjectGraphFlowNodes(clusterInputs(collapsedView));
    const frame = nodes.find((node) => node.id === "cluster:api/api");
    expect(frame?.type).toBe(CLUSTER_NODE_TYPE);
    const clusterData = frame?.type === CLUSTER_NODE_TYPE ? frame.data.cluster : null;
    expect(clusterData?.collapsed).toBe(true);
    expect(nodes.some((node) => node.id === GET.id)).toBe(false);
    expect(nodes.some((node) => node.id === PAGE.id)).toBe(false);
  });

  it("an in-flight drag keeps its position across a rebuild", () => {
    const nodes = buildProjectGraphFlowNodes(clusterInputs(view));
    const child = nodes.find((node) => node.id === GET.id);
    expect(child).toBeDefined();
    if (child === undefined) return;
    const dragging = { ...child, dragging: true, position: { x: 9, y: 9 } };
    const rebuilt = buildProjectGraphFlowNodes(clusterInputs(view, { previous: [dragging] }));
    expect(rebuilt.find((node) => node.id === GET.id)?.position).toEqual({ x: 9, y: 9 });
  });
});

// A hub hover (issue #64) is one more dimming channel: only the hub's routes and target stay
// bright, every other card recedes — opacity only, positions and selection never move.
describe("buildProjectGraphFlowNodes hub hover (issue #64)", () => {
  it("dims every card the hover does not name, keeping positions and selection", () => {
    const hubIsolation = {
      nodeIds: new Set(["hub:route-table:table:todos", GET.id, TODOS.id]),
      edgeIds: new Set(["route-table:1"]),
    };
    const hovered = buildProjectGraphFlowNodes(
      clusterInputs(VIEW, { hubIsolation, notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }] }),
    );
    expect(cardData(hovered, GET.id).focused).toBe(true);
    expect(cardData(hovered, TODOS.id).focused).toBe(true);
    expect(cardData(hovered, PAGE.id).focused).toBe(false);
    expect(cardData(hovered, WORKFLOW.id).focused).toBe(false);
    expect(cardData(hovered, "note-1").focused).toBe(false);
    const plain = buildProjectGraphFlowNodes(
      clusterInputs(VIEW, { notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }] }),
    );
    for (const node of hovered) {
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      expect(node.selected).toBe(before?.selected);
    }
  });
});

// The contract lens's audit dimming (issue #69): the ribbon's counters filter by dimming only —
// matching cards stay bright, the rest recede to 40%, and positions/selection never move (epic
// rule 2). The badges and the ring read the lens context, not node data; only the dim channel
// is decided by this mapping, like every other dim channel.
const MYSTERY = routeNode("POST", "/api/mystery", { unknown: true, wrapper: "unknown" });
const CONTRACT_VIEW = buildProjectGraphView({
  graph: graphOf([PAGE, GET, TODOS, WORKFLOW, MYSTERY], EDGES),
});
const CONTRACT_DIAGNOSTIC: Diagnostic = {
  code: "schema-unknown",
  severity: "warning",
  message: "unreadable column",
  source: { file: "db/schema.ts", line: 4 },
};

function auditDimmedOf(nodes: readonly ProjectFlowNode[], id: string): boolean {
  const data = cardData(nodes, id);
  if (!("auditDimmed" in data)) throw new Error("not an analysis card: " + id);
  return data.auditDimmed;
}

function buildContract(
  contract: {
    auditFilters: readonly ("protected" | "missingInput" | "unknown" | "diagnostics")[];
    nodeDiagnostics?: ReadonlyMap<string, readonly Diagnostic[]>;
  },
  selectedNodeId: string | null = null,
) {
  return buildProjectGraphFlowNodes(
    clusterInputs(CONTRACT_VIEW, {
      selectedNodeId,
      notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
      contract: { nodeDiagnostics: new Map(), ...contract },
    }),
  );
}

describe("buildProjectGraphFlowNodes contract audit dimming (issue #69)", () => {
  it("dims nothing without the lens inputs or with an empty filter set", () => {
    const absent = buildProjectGraphFlowNodes(clusterInputs(CONTRACT_VIEW));
    const empty = buildContract({ auditFilters: [] });
    for (const nodes of [absent, empty]) {
      for (const id of [PAGE.id, GET.id, TODOS.id, WORKFLOW.id, MYSTERY.id]) {
        expect(auditDimmedOf(nodes, id)).toBe(false);
      }
    }
  });

  it("keeps the matching cards bright and dims the rest, positions and selection held", () => {
    const filtered = buildContract({ auditFilters: ["protected"] }, GET.id);
    // GET is the fixture's protected route (valid wrapper + required permission).
    expect(auditDimmedOf(filtered, GET.id)).toBe(false);
    expect(auditDimmedOf(filtered, PAGE.id)).toBe(true);
    expect(auditDimmedOf(filtered, TODOS.id)).toBe(true);
    expect(auditDimmedOf(filtered, WORKFLOW.id)).toBe(true);
    expect(auditDimmedOf(filtered, MYSTERY.id)).toBe(true);
    const plain = buildContract({ auditFilters: [] }, GET.id);
    for (const node of filtered) {
      const before = plain.find((entry) => entry.id === node.id);
      expect(node.position).toEqual(before?.position);
      expect(node.selected).toBe(before?.selected);
    }
  });

  it("never scores an unknown route as missing input: unknown is its own counter", () => {
    const missing = buildContract({ auditFilters: ["missingInput"] });
    // GET has no input schema in the fixture; MYSTERY's facts are unreadable, not absent.
    expect(auditDimmedOf(missing, GET.id)).toBe(false);
    expect(auditDimmedOf(missing, MYSTERY.id)).toBe(true);
    const unknown = buildContract({ auditFilters: ["unknown"] });
    expect(auditDimmedOf(unknown, MYSTERY.id)).toBe(false);
    expect(auditDimmedOf(unknown, GET.id)).toBe(true);
  });

  it("unions the pressed counters and matches attached diagnostics", () => {
    const union = buildContract({ auditFilters: ["protected", "unknown"] });
    expect(auditDimmedOf(union, GET.id)).toBe(false);
    expect(auditDimmedOf(union, MYSTERY.id)).toBe(false);
    expect(auditDimmedOf(union, TODOS.id)).toBe(true);
    const withDiagnostics = buildContract({
      auditFilters: ["diagnostics"],
      nodeDiagnostics: new Map([[TODOS.id, [CONTRACT_DIAGNOSTIC]]]),
    });
    expect(auditDimmedOf(withDiagnostics, TODOS.id)).toBe(false);
    expect(auditDimmedOf(withDiagnostics, GET.id)).toBe(true);
  });

  it("keeps the audit dimming off the notes: annotations are not contract subjects", () => {
    const note = buildContract({ auditFilters: ["protected"] }).find(
      (entry) => entry.id === "note-1",
    );
    expect(note?.data).not.toHaveProperty("auditDimmed");
  });
});
// ── data lens composition (issue #70, epic #56 rules 2-3) ─────────────────────────────────

const A = tableNode("a");
const B = tableNode("b");
const C = tableNode("c");
const ROUTE = routeNode("GET", "/api/a", { dbTables: ["a"] });
const DATA_EDGES: GraphEdge[] = [
  { id: "fk1", kind: "fk", source: A.id, target: B.id, label: null },
  // A relation edge closes the schema mesh (fkNeighbourhood treats fk/relation as schema) but
  // is not an fk kind, so edge isolation (below) dims C while the data lens still reaches it.
  { id: "rel2", kind: "relation", source: B.id, target: C.id, label: null },
  // The route writes a: it is in a's FULL closure but outside the FK neighbourhood, so the
  // data-lens highlight is strictly stricter than #66's default — and still opacity only.
  { id: "e3", kind: "route-table", source: ROUTE.id, target: A.id, label: null },
];
const DATA_POSITIONS: Record<string, { x: number; y: number }> = {
  [A.id]: { x: 10, y: 10 },
  [B.id]: { x: 10, y: 100 },
  [C.id]: { x: 10, y: 190 },
  [ROUTE.id]: { x: 300, y: 10 },
};
const flatDataView = buildProjectGraphView({ graph: graphOf([ROUTE, A, B, C], DATA_EDGES) });
const dataView: ProjectGraphView = {
  ...flatDataView,
  nodes: flatDataView.nodes.map((entry) => ({
    ...entry,
    position: DATA_POSITIONS[entry.id] ?? entry.position,
  })),
};

const buildData = (
  data: ProjectFlowDataState | undefined,
  userFocus: GraphReachability | null = null,
  isolatedEdgeKinds: readonly GraphEdgeKind[] = [],
) =>
  buildProjectGraphFlowNodes({
    view: dataView,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId: A.id,
    focus: null,
    userFocus,
    isolatedEdgeKinds,
    drill: null,
    hubIsolation: null,
    data,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });

const cardsOf = (nodes: ReturnType<typeof buildData>): ProjectAnalysisFlowNode[] =>
  nodes.filter((entry): entry is ProjectAnalysisFlowNode => entry.id !== "note-1");

const positionsOf = (nodes: ReturnType<typeof buildData>) =>
  nodes.map((entry) => entry.id + "@" + entry.position.x + "," + entry.position.y).toSorted();

describe("buildProjectGraphFlowNodes data lens", () => {
  it("carries no data role when the lens is inactive or absent", () => {
    for (const entry of cardsOf(buildData(undefined))) {
      expect(entry.data.dataRole).toBeNull();
      expect(entry.data.compactData).toBe(false);
    }
    for (const entry of cardsOf(buildData({ activeLenses: ["contract"], compactData: true }))) {
      expect(entry.data.dataRole).toBeNull();
    }
  });

  it("assigns the dominant and secondary roles through the shared lens mechanism", () => {
    const dominant = buildData({ activeLenses: ["data", "contract"], compactData: false });
    for (const entry of cardsOf(dominant)) expect(entry.data.dataRole).toBe("dominant");
    const secondary = buildData({ activeLenses: ["contract", "data"], compactData: true });
    for (const entry of cardsOf(secondary)) {
      expect(entry.data.dataRole).toBe("secondary");
      expect(entry.data.compactData).toBe(true);
    }
  });

  it("keeps the data marks off the notes: annotations are not schema subjects", () => {
    const note = buildData({ activeLenses: ["data"], compactData: false }).find(
      (entry) => entry.id === "note-1",
    );
    expect(note?.data).not.toHaveProperty("dataRole");
  });

  it("dims the FK neighbourhood's outsiders without removing cards or moving positions", () => {
    const fkFocus = fkNeighbourhood(dataView, A.id);
    // The route is in the full closure but not in the FK mesh: the lens highlight is stricter.
    const full = reachabilityClosure(dataView, A.id);
    expect(full?.nodeIds).toContain(ROUTE.id);
    expect(fkFocus?.nodeIds).not.toContain(ROUTE.id);

    const baseline = buildData(undefined);
    const highlighted = buildData({ activeLenses: ["data"], compactData: false }, fkFocus);
    const byId = new Map(cardsOf(highlighted).map((entry) => [entry.id, entry]));
    expect(byId.get(A.id)?.data.focused).toBe(true);
    expect(byId.get(B.id)?.data.focused).toBe(true);
    expect(byId.get(C.id)?.data.focused).toBe(true);
    expect(byId.get(ROUTE.id)?.data.focused).toBe(false);
    // Dimming only: every card survives, at its exact baseline position, selection intact.
    expect(highlighted).toHaveLength(baseline.length);
    expect(positionsOf(highlighted)).toEqual(positionsOf(baseline));
    expect(byId.get(A.id)?.selected).toBe(true);
  });

  it("holds positions under data lens + edge isolation + lens stacking (criterion 5)", () => {
    const baseline = buildData(undefined);
    const fkFocus = fkNeighbourhood(dataView, A.id);
    const composed = buildData({ activeLenses: ["contract", "data"], compactData: true }, fkFocus, [
      "fk",
    ]);
    expect(positionsOf(composed)).toEqual(positionsOf(baseline));
    expect(composed).toHaveLength(baseline.length);
    // Isolation still dims independently: c touches no fk edge, the route neither.
    const byId = new Map(cardsOf(composed).map((entry) => [entry.id, entry]));
    expect(byId.get(C.id)?.data.isolated).toBe(true);
    expect(byId.get(ROUTE.id)?.data.isolated).toBe(true);
    expect(byId.get(A.id)?.data.isolated).toBe(false);
    // The data lens is secondary while contract dominates; both flags coexist on one card.
    expect(cardsOf(composed).find((entry) => entry.id === A.id)?.data.dataRole).toBe("secondary");
  });
});

// ── agent turn-diff lens (issue #73): chrome and tombstones as data, never a move ───────────

const buildTurn = (turn: TurnOverlay | null) =>
  buildProjectGraphFlowNodes({
    view: VIEW,
    notes: [],
    previous: [],
    selectedNodeId: null,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    drill: null,
    hubIsolation: null,
    turn,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
  });

const overlayOf = (diff: GraphTurnDiff, secondary = false): TurnOverlay => ({ diff, secondary });

function nodeAt(id: string, x: number) {
  const base = VIEW.nodes[0];
  if (base === undefined) throw new Error("fixture view is empty");
  return { ...base, id, label: id, position: { x, y: 10 } };
}

const TURN: GraphTurnDiff = {
  ...INACTIVE_TURN_DIFF,
  active: true,
  nodeKinds: new Map([
    [PAGE.id, "modified"],
    [GET.id, "added"],
  ]),
  tombstones: [nodeAt(TODOS.id, 200)],
  tombstoneIds: new Set([TODOS.id]),
};

function cardOf(nodes: readonly ProjectFlowNode[], id: string): ProjectAnalysisFlowNode {
  const found = nodes.find((node) => node.id === id);
  if (
    found === undefined ||
    found.type === TURN_NODE_TYPE ||
    found.type === "note" ||
    found.type === DETAILS_NODE_TYPE ||
    found.type === CLUSTER_NODE_TYPE ||
    found.type === HUB_NODE_TYPE
  ) {
    throw new Error("expected an analysis card: " + id);
  }
  return found;
}

function turnOf(nodes: readonly ProjectFlowNode[], id: string): ProjectTurnFlowNode {
  const found = nodes.find((node) => node.id === id);
  if (found === undefined || found.type !== TURN_NODE_TYPE) {
    throw new Error("expected a turn-diff card: " + id);
  }
  return found;
}

const positionsOfCards = (nodes: readonly ProjectFlowNode[]) =>
  nodes
    .filter((node) => node.type !== TURN_NODE_TYPE)
    .map((node) => node.id + "@" + node.position.x + "," + node.position.y)
    .toSorted();

describe("buildProjectGraphFlowNodes turn-diff", () => {
  it("renders exactly as without the lens when the diff is absent or inactive", () => {
    const plain = buildTurn(null);
    expect(buildTurn(overlayOf(INACTIVE_TURN_DIFF))).toEqual(plain);
    expect(plain.every((node) => node.type !== TURN_NODE_TYPE)).toBe(true);
    for (const id of [PAGE.id, GET.id, TODOS.id, WORKFLOW.id]) {
      expect(cardOf(plain, id).data.turn).toBeNull();
    }
  });

  it("badges changed and added cards and tombstones the stale deleted card in place", () => {
    const nodes = buildTurn(overlayOf(TURN));
    expect(cardOf(nodes, PAGE.id).data.turn).toEqual({ kind: "modified", secondary: false });
    expect(cardOf(nodes, GET.id).data.turn).toEqual({ kind: "added", secondary: false });
    const todo = VIEW.nodes.find((node) => node.id === TODOS.id);
    if (todo === undefined) throw new Error("missing fixture node");
    const tombstone = turnOf(nodes, TODOS.id);
    // Same id, same position: the hole is visible without re-layout or a duplicate card.
    expect(tombstone.position).toEqual(todo.position);
    expect(tombstone.draggable).toBe(false);
    expect(tombstone.selectable).toBe(false);
    expect(nodes.filter((node) => node.id === TODOS.id)).toHaveLength(1);
  });

  it("appends a base-only tombstone at its last-known position, moving nothing", () => {
    const diff: GraphTurnDiff = {
      ...INACTIVE_TURN_DIFF,
      active: true,
      tombstones: [nodeAt("gone", 500)],
      tombstoneIds: new Set(["gone"]),
    };
    const baseline = buildTurn(null);
    const nodes = buildTurn(overlayOf(diff));
    expect(turnOf(nodes, "gone").position).toEqual({ x: 500, y: 10 });
    // Every live card keeps its exact baseline position (epic rule 2).
    expect(positionsOfCards(nodes)).toEqual(positionsOfCards(baseline));
  });

  it("fades the chrome when the lens is secondary (epic rule 3)", () => {
    const nodes = buildTurn(overlayOf(TURN, true));
    expect(cardOf(nodes, PAGE.id).data.turn).toEqual({ kind: "modified", secondary: true });
    expect(turnOf(nodes, TODOS.id).data.secondary).toBe(true);
  });

  it("parks phase-2 ghosts below the graph and never invents them without a plan", () => {
    const without = buildTurn(overlayOf(TURN));
    expect(without.some((node) => node.id.startsWith("turn-ghost:"))).toBe(false);
    const diff: GraphTurnDiff = { ...TURN, ghosts: [{ path: "src/pages/planned.tsx" }] };
    const ghost = turnOf(buildTurn(overlayOf(diff)), "turn-ghost:src/pages/planned.tsx");
    expect(ghost.position.y).toBeGreaterThan(10);
    expect(ghost.data.turnKind).toBe("planned");
  });

  it("never moves a live card when the lens activates (spatial constancy)", () => {
    const baseline = new Map(buildTurn(null).map((node) => [node.id, node.position]));
    const lens = new Map(buildTurn(overlayOf(TURN)).map((node) => [node.id, node.position]));
    for (const id of [PAGE.id, GET.id, WORKFLOW.id]) {
      expect(lens.get(id), id).toEqual(baseline.get(id));
    }
    // The tombstoned node keeps its last-known position; it simply draws as a tombstone.
    expect(lens.get(TODOS.id)).toEqual(baseline.get(TODOS.id));
  });
});
