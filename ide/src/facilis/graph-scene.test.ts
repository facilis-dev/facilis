import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { emptyGraphLayout, withEdgeCurve, withNodePosition } from "./graph-layout";
import { buildProjectGraphView } from "./graph-model";
import { GET, PAGE, TODOS, graphOf, pageNode } from "./graph-model.test-fixtures";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import {
  MAX_SCENE_EDGES,
  MAX_SCENE_NODES,
  buildGraphScene,
  type GraphSceneFocus,
  type GraphScenePalette,
} from "./graph-scene";
import { reachabilityClosure } from "./graph-reachability";
import { USER_FOCUS_OPACITY } from "./graph-user-focus";

const palette: GraphScenePalette = {
  background: "#ffffff",
  card: "#fafafa",
  border: "#dddddd",
  text: "#111111",
  muted: "#666666",
  outline: "#2563eb",
  edges: {
    fk: { stroke: "fk-stroke", dashed: false },
    relation: { stroke: "relation-stroke", dashed: true },
    "route-table": { stroke: "route-table-stroke", dashed: false },
    "page-route": { stroke: "page-route-stroke", dashed: false },
    "page-link": { stroke: "page-link-stroke", dashed: false },
    "route-view": { stroke: "route-view-stroke", dashed: true },
    "view-base": { stroke: "view-base-stroke", dashed: true },
  },
  elevated: { stroke: "elevated-stroke", dashed: false },
};

const PAGE_ROUTE: GraphEdge = {
  id: "page-route:1",
  kind: "page-route",
  source: PAGE.id,
  target: GET.id,
  label: null,
};
const ROUTE_TABLE: GraphEdge = {
  id: "route-table:1",
  kind: "route-table",
  source: GET.id,
  target: TODOS.id,
  label: "dbTables",
};

function layoutOf() {
  let layout = emptyGraphLayout();
  layout = withNodePosition(layout, PAGE.id, { x: 0, y: 0 });
  layout = withNodePosition(layout, GET.id, { x: 500, y: 0 });
  layout = withNodePosition(layout, TODOS.id, { x: 1000, y: 300 });
  return layout;
}

const view = buildProjectGraphView({
  graph: graphOf([PAGE, GET, TODOS], [PAGE_ROUTE, ROUTE_TABLE]),
  positions: layoutOf().nodes,
});

describe("buildGraphScene", () => {
  it("is deterministic and orders nodes and edges by id", () => {
    const first = buildGraphScene(view, layoutOf(), palette);
    const second = buildGraphScene(view, layoutOf(), palette);
    expect(second).toEqual(first);
    const ids = first.nodes.map((node) => node.id);
    expect(ids).toEqual(ids.toSorted());
    const edgeIds = first.edges.map((edge) => edge.id);
    expect(edgeIds).toEqual(edgeIds.toSorted());
  });

  it("uses the card size per kind and pads the canvas", () => {
    const scene = buildGraphScene(view, layoutOf(), palette);
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    // The scene draws the FULL-card footprint shared with the canvas (graph-node-size.ts):
    // chip/compact render inside it, so the picture agrees with the live edge anchoring at
    // every LOD level (issue #60).
    expect(byId.get(PAGE.id)?.rect).toEqual({ x: 72, y: 72, ...GRAPH_NODE_SIZES.page });
    expect(byId.get(GET.id)?.rect).toEqual({ x: 572, y: 72, ...GRAPH_NODE_SIZES.route });
    expect(byId.get(TODOS.id)?.rect).toEqual({ x: 1072, y: 372, ...GRAPH_NODE_SIZES.table });
    // Bounds: x 0..1240, y 0..388, plus 72 px of padding on every side.
    expect(scene.width).toBe(1384);
    expect(scene.height).toBe(532);
  });

  it("paints the palette and its dashedness per edge kind", () => {
    const scene = buildGraphScene(view, layoutOf(), palette);
    const byId = new Map(scene.edges.map((edge) => [edge.id, edge]));
    expect(byId.get(ROUTE_TABLE.id)).toMatchObject({
      stroke: "route-table-stroke",
      dashed: false,
    });
    expect(scene.edges.every((edge) => edge.path.startsWith("M "))).toBe(true);
  });

  it("uses the elevated style for audited edges", () => {
    const elevatedView = buildProjectGraphView({
      graph: graphOf([PAGE, GET], [{ ...PAGE_ROUTE, access: "elevated" }]),
      positions: layoutOf().nodes,
    });
    const scene = buildGraphScene(elevatedView, layoutOf(), palette);
    expect(scene.edges[0]).toMatchObject({ stroke: "elevated-stroke", dashed: false });
  });

  it("applies a saved edge curve to the path", () => {
    const curved = withEdgeCurve(layoutOf(), ROUTE_TABLE.id, { x: 12, y: -8 });
    const straight = buildGraphScene(view, layoutOf(), palette);
    const bent = buildGraphScene(view, curved, palette);
    const straightPath = straight.edges.find((edge) => edge.id === ROUTE_TABLE.id)?.path;
    const bentPath = bent.edges.find((edge) => edge.id === ROUTE_TABLE.id)?.path;
    expect(bentPath).not.toBe(straightPath);
    // The router draws orthogonal segments; the curve bends the middle one.
    expect(bentPath).toMatch(/^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? L /u);
  });

  it("draws a self-loop as a cubic path", () => {
    const selfEdge: GraphEdge = {
      id: "fk:self",
      kind: "fk",
      source: TODOS.id,
      target: TODOS.id,
      label: null,
    };
    const selfView = buildProjectGraphView({
      graph: graphOf([TODOS], [selfEdge]),
      positions: layoutOf().nodes,
    });
    const scene = buildGraphScene(selfView, layoutOf(), palette);
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0]?.path).toMatch(/^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? C /u);
  });

  it("caps the cards and keeps only edges between the drawn cards", () => {
    const nodes = Array.from({ length: MAX_SCENE_NODES + 5 }, (_value, index) =>
      pageNode("src/pages/page-" + String(index) + ".tsx"),
    );
    const edges: GraphEdge[] = nodes.map((node, index) => ({
      id: "page-link:" + String(index),
      kind: "page-link",
      source: node.id,
      target: nodes[(index + 1) % nodes.length]?.id ?? node.id,
      label: null,
    }));
    const cappedView = buildProjectGraphView({ graph: graphOf(nodes, edges) });
    const scene = buildGraphScene(cappedView, emptyGraphLayout(), palette);
    expect(scene.nodes).toHaveLength(MAX_SCENE_NODES);
    expect(scene.truncated).toBe(true);
    expect(scene.nodes.some((node) => node.rect.width !== 224)).toBe(false);
  });

  it("caps the edges at the scene limit", () => {
    const manyEdges: GraphEdge[] = Array.from(
      { length: MAX_SCENE_EDGES + 20 },
      (_value, index) => ({
        id: "page-link:" + String(index).padStart(4, "0"),
        kind: "page-link",
        source: PAGE.id,
        target: GET.id,
        label: null,
      }),
    );
    const edgeView = buildProjectGraphView({ graph: graphOf([PAGE, GET], manyEdges) });
    const scene = buildGraphScene(edgeView, emptyGraphLayout(), palette);
    expect(scene.edges).toHaveLength(MAX_SCENE_EDGES);
    expect(scene.truncated).toBe(true);
  });

  it("returns an empty scene for an empty view", () => {
    const emptyView = buildProjectGraphView({ graph: graphOf([]) });
    expect(buildGraphScene(emptyView, emptyGraphLayout(), palette)).toEqual({
      width: 0,
      height: 0,
      nodes: [],
      edges: [],
      truncated: false,
    });
  });
});

// The screenshot carries the same two channels the canvas composes (issue #66 criterion 5):
// the user closure dims outsiders to 12%, the AI focus outlines what it names. D-171 forbids
// pixel snapshots in Node, so the composition is proved here, on the scene the painter draws.
describe("buildGraphScene focus overlay", () => {
  const ABOUT = pageNode("src/pages/about.tsx");
  const LINK: GraphEdge = {
    id: "page-link:1",
    kind: "page-link",
    source: PAGE.id,
    target: ABOUT.id,
    label: null,
  };
  const focusView = buildProjectGraphView({
    graph: graphOf([PAGE, GET, TODOS, ABOUT], [PAGE_ROUTE, ROUTE_TABLE, LINK]),
    positions: layoutOf().nodes,
  });
  const closure = reachabilityClosure(focusView, GET.id);
  if (closure === null) throw new Error("fixture closure must exist");
  const userOnly: GraphSceneFocus = {
    userNodes: new Set(closure.nodeIds),
    userEdges: new Set(closure.edgeIds),
    aiNodes: new Set(),
    aiEdges: new Set(),
  };
  const aiOnly: GraphSceneFocus = {
    userNodes: null,
    userEdges: null,
    aiNodes: new Set([ABOUT.id]),
    aiEdges: new Set([LINK.id]),
  };

  it("keeps every card and edge bright and unoutlined without an overlay", () => {
    const scene = buildGraphScene(focusView, layoutOf(), palette);
    expect(scene.nodes.every((node) => node.opacity === 1 && !node.outlined)).toBe(true);
    expect(scene.edges.every((edge) => edge.opacity === 1 && !edge.outlined)).toBe(true);
  });

  it("dims the cards and edges outside the user's closure to 12%", () => {
    const scene = buildGraphScene(focusView, layoutOf(), palette, userOnly);
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    expect(byId.get(ABOUT.id)?.opacity).toBe(USER_FOCUS_OPACITY);
    expect(byId.get(GET.id)?.opacity).toBe(1);
    expect(byId.get(PAGE.id)?.opacity).toBe(1);
    const link = scene.edges.find((edge) => edge.id === LINK.id);
    expect(link?.opacity).toBe(USER_FOCUS_OPACITY);
    expect(scene.edges.find((edge) => edge.id === ROUTE_TABLE.id)?.opacity).toBe(1);
  });

  it("outlines the AI-named cards and edges without dimming anything", () => {
    const scene = buildGraphScene(focusView, layoutOf(), palette, aiOnly);
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    expect(byId.get(ABOUT.id)?.outlined).toBe(true);
    // The named edge's endpoints carry the outline too (the D-171 edge-only semantics).
    expect(byId.get(PAGE.id)?.outlined).toBe(true);
    expect(byId.get(GET.id)?.outlined).toBe(false);
    expect(scene.nodes.every((node) => node.opacity === 1)).toBe(true);
    expect(scene.edges.find((edge) => edge.id === LINK.id)?.outlined).toBe(true);
  });

  it("composes both channels: a dimmed card can still carry the AI outline", () => {
    const both: GraphSceneFocus = {
      userNodes: userOnly.userNodes,
      userEdges: userOnly.userEdges,
      aiNodes: aiOnly.aiNodes,
      aiEdges: aiOnly.aiEdges,
    };
    const scene = buildGraphScene(focusView, layoutOf(), palette, both);
    const byId = new Map(scene.nodes.map((node) => [node.id, node]));
    // ABOUT is outside the closure but AI-named: dimmed AND outlined, both channels visible.
    expect(byId.get(ABOUT.id)?.opacity).toBe(USER_FOCUS_OPACITY);
    expect(byId.get(ABOUT.id)?.outlined).toBe(true);
    // PAGE is inside the closure and an AI edge endpoint: bright AND outlined.
    expect(byId.get(PAGE.id)?.opacity).toBe(1);
    expect(byId.get(PAGE.id)?.outlined).toBe(true);
    const link = scene.edges.find((edge) => edge.id === LINK.id);
    expect(link?.opacity).toBe(USER_FOCUS_OPACITY);
    expect(link?.outlined).toBe(true);
  });

  it("stays deterministic with an overlay", () => {
    const first = buildGraphScene(focusView, layoutOf(), palette, userOnly);
    const second = buildGraphScene(focusView, layoutOf(), palette, userOnly);
    expect(second).toEqual(first);
  });
});
