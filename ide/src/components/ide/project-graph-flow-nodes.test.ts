// The chip's edge count is derived from the visible view (issue #60, epic rule 5): each edge
// counts once per endpoint and a self-loop once; an unconnected node reads zero, never a guess.
// Edge-kind isolation (issue #63) is opacity only: cards no isolated edge touches recede to 10%,
// notes always recede, and positions/selection never move (epic rule 2).
// The focus-channel composition (issue #66) lives in project-graph-flow-focus.test.ts.
import { describe, expect, it } from "vitest";
import type { Diagnostic, GraphEdge, GraphEdgeKind } from "@facilis.dev/analyze";
import { buildProjectGraphView } from "@/facilis/graph-model";
import {
  GET,
  PAGE,
  TODOS,
  WORKFLOW,
  graphOf,
  routeNode,
} from "@/facilis/graph-model.test-fixtures";
import { CLUSTER_NODE_TYPE } from "./ProjectGraphClusterNode";
import { DETAILS_NODE_TYPE } from "./ProjectGraphDetailsNode";
import { HUB_NODE_TYPE } from "./ProjectGraphHubNode";
import type { ProjectFlowNode } from "./ProjectGraphNodes";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";

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
    node.type === HUB_NODE_TYPE
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
