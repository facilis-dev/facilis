// The two focus channels compose (issue #66 criterion 5): the USER focus dims outsiders to
// 12% (data.focused=false), the AI focus outlines what it names (data.aiOutlined=true) and
// never dims. A card can carry both flags at once; clearing either leaves the other untouched,
// and positions/selection never move. The class strings are proved in
// ProjectGraphNodeChrome.test.ts; the browser gate proves the pixels.
import { describe, expect, it } from "vitest";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import { reachabilityClosure, type GraphReachability } from "@/facilis/graph-reachability";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";
import { buildProjectGraphFlowNodes } from "./project-graph-flow-nodes";
import type { ProjectFlowData, ProjectFlowNode } from "./ProjectGraphNodes";
import type { ProjectGraphFocusState } from "./useProjectGraphFocus";

const node = (id: string, x: number): ProjectGraphNode => ({
  id,
  kind: "table",
  label: id,
  sourceFile: null,
  position: { x, y: 10 },
  data: {
    kind: "table",
    table: id,
    columns: [],
    rlsEnabled: true,
    framework: false,
    scope: null,
    policies: [],
    unknown: false,
  },
  matched: true,
  collapsed: false,
});

const edge = (
  id: string,
  kind: ProjectGraphEdge["kind"],
  source: string,
  target: string,
): ProjectGraphEdge => ({ id, kind, source, target, label: null });

// a ↔ b ↔ c is the schema mesh; d writes a; d also writes w, which is OUTSIDE a's closure
// (w is downstream of an upstream node — neither a reacher of a nor reached by it).
const view: ProjectGraphView = {
  nodes: [node("a", 0), node("b", 100), node("c", 200), node("d", 300), node("w", 400)],
  edges: [
    edge("e1", "fk", "a", "b"),
    edge("e2", "relation", "b", "c"),
    edge("e3", "route-table", "d", "a"),
    edge("e4", "route-table", "d", "w"),
  ],
  stats: {
    pages: 0,
    routes: 0,
    tables: 5,
    views: 0,
    workflows: 0,
    edges: 4,
    hiddenEdges: 0,
    hiddenNodes: 0,
    matches: 5,
    unknownNodes: 0,
    pageLinks: 0,
    elevatedEdges: 0,
  },
  layoutSize: { width: 656, height: 98 },
};

function closureOf(id: string): GraphReachability {
  const closure = reachabilityClosure(view, id);
  if (closure === null) throw new Error("fixture id not visible: " + id);
  return closure;
}

const aiFocus: ProjectGraphFocusState = {
  nodeIds: new Set(["w"]),
  edgeIds: new Set(["e4"]),
  zoom: false,
};

const buildNodes = (
  userFocus: GraphReachability | null,
  focus: ProjectGraphFocusState | null = null,
) =>
  buildProjectGraphFlowNodes({
    view,
    notes: [{ id: "note-1", x: 5, y: 5, text: "hello" }],
    previous: [],
    selectedNodeId: "w",
    focus,
    userFocus,
    isolatedEdgeKinds: [],
    onToggleCollapse: () => {},
    onEditNote: () => {},
    onDeleteNote: () => {},
  });

const buildEdges = (
  userFocus: GraphReachability | null,
  focus: ProjectGraphFocusState | null = null,
) =>
  buildProjectGraphFlowEdges({
    view,
    edgeCurves: {},
    selectedEdgeId: null,
    focus,
    userFocus,
    isolatedEdgeKinds: [],
    onEdgeCurveChange: () => {},
  });

/** The analysis card's data; notes carry no outline channel (they are not AI-addressable). */
function cardData(nodes: readonly ProjectFlowNode[], id: string): ProjectFlowData {
  const found = nodes.find((n) => n.id === id);
  if (found === undefined || !("aiOutlined" in found.data)) throw new Error("not a card: " + id);
  return found.data;
}

/** The dim flag every card and note carries (this builder never emits the details satellite). */
function focusedFlag(nodes: readonly ProjectFlowNode[], id: string): boolean {
  const found = nodes.find((n) => n.id === id);
  if (found === undefined || !("focused" in found.data)) throw new Error("missing " + id);
  return found.data.focused;
}

describe("user focus dimming (nodes)", () => {
  it("dims only the cards outside the closure, keeping positions and selection", () => {
    const nodes = buildNodes(closureOf("a"));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(focusedFlag(nodes, "a")).toBe(true);
    expect(focusedFlag(nodes, "d")).toBe(true);
    expect(focusedFlag(nodes, "w")).toBe(false);
    // Opacity only: the dimmed card keeps its place and its selection.
    expect(byId.get("w")?.position).toEqual({ x: 400, y: 10 });
    expect(byId.get("w")?.selected).toBe(true);
    expect(nodes).toHaveLength(6);
  });

  it("clearing the user focus restores exactly the previous state", () => {
    const dimmed = buildNodes(closureOf("a"));
    const cleared = buildNodes(null);
    expect(cleared.every((n) => "focused" in n.data && n.data.focused)).toBe(true);
    // Same identities, positions and selection before and after — only the dim flag differed.
    expect(cleared.map((n) => [n.id, n.position, n.selected])).toEqual(
      dimmed.map((n) => [n.id, n.position, n.selected]),
    );
  });

  it("recedes notes with the graph while the user focus is active", () => {
    expect(focusedFlag(buildNodes(closureOf("a")), "note-1")).toBe(false);
    expect(focusedFlag(buildNodes(null), "note-1")).toBe(true);
  });
});

describe("AI focus outline channel (nodes)", () => {
  it("never dims: without a user focus every card stays bright", () => {
    const nodes = buildNodes(null, aiFocus);
    expect(nodes.every((n) => "focused" in n.data && n.data.focused)).toBe(true);
  });

  it("outlines the named cards and the endpoints of a named edge", () => {
    const nodes = buildNodes(null, aiFocus);
    expect(cardData(nodes, "w").aiOutlined).toBe(true);
    // e4 connects d → w: both endpoints carry the outline (D-171 edge-only semantics).
    expect(cardData(nodes, "d").aiOutlined).toBe(true);
    expect(cardData(nodes, "a").aiOutlined).toBe(false);
    expect(nodes.find((n) => n.id === "note-1")?.data).not.toHaveProperty("aiOutlined");
  });
});

describe("both channels together (criterion 5)", () => {
  it("a card outside the closure but AI-named is dimmed AND outlined", () => {
    const nodes = buildNodes(closureOf("a"), aiFocus);
    expect(cardData(nodes, "w").focused).toBe(false);
    expect(cardData(nodes, "w").aiOutlined).toBe(true);
    // Inside the closure and AI-named: bright AND outlined.
    expect(cardData(nodes, "d").focused).toBe(true);
    expect(cardData(nodes, "d").aiOutlined).toBe(true);
    // Inside the closure, not AI-named: bright, no outline.
    expect(cardData(nodes, "a").focused).toBe(true);
    expect(cardData(nodes, "a").aiOutlined).toBe(false);
  });

  it("clearing the AI focus leaves the user dimming untouched", () => {
    const both = buildNodes(closureOf("a"), aiFocus);
    const userOnly = buildNodes(closureOf("a"));
    expect(userOnly.map((n) => "focused" in n.data && n.data.focused)).toEqual(
      both.map((n) => "focused" in n.data && n.data.focused),
    );
    expect(["a", "b", "c", "d", "w"].every((id) => !cardData(userOnly, id).aiOutlined)).toBe(true);
  });
});

describe("user focus dimming (edges)", () => {
  it("dims only the edges leaving the closure and keeps the AI outline independent", () => {
    const edges = buildEdges(closureOf("a"), aiFocus);
    const byId = new Map(edges.map((e) => [e.id, e]));
    expect(byId.get("e1")?.data?.userDimmed).toBe(false);
    expect(byId.get("e3")?.data?.userDimmed).toBe(false);
    // e4 leaves the closure (w outside): dimmed, yet still AI-outlined — both channels visible.
    expect(byId.get("e4")?.data?.userDimmed).toBe(true);
    expect(byId.get("e4")?.data?.aiOutlined).toBe(true);
    expect(byId.get("e1")?.data?.aiOutlined).toBe(false);
    expect(edges).toHaveLength(4);
  });

  it("adds no user dimming when no selection closure is active", () => {
    const edges = buildEdges(null, aiFocus);
    expect(edges.every((e) => e.data?.userDimmed === undefined)).toBe(true);
    expect(edges.map((e) => e.data?.aiOutlined)).toEqual([false, false, false, true]);
  });

  it("clearing the user focus restores exactly the previous edge state", () => {
    const dimmed = buildEdges(closureOf("a"));
    const cleared = buildEdges(null);
    expect(cleared.every((e) => e.data?.userDimmed === undefined)).toBe(true);
    expect(cleared.map((e) => [e.id, e.source, e.target])).toEqual(
      dimmed.map((e) => [e.id, e.source, e.target]),
    );
  });
});
