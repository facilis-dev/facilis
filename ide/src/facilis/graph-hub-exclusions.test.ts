// Issue #64 exclusions: hubs are render artefacts. They must never appear in the AI/screenshot
// scene, in the exported layout (.facilis/graph, v3) or in the URL state — only the threshold
// value is addressable. Stats stay computed on the real edges.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import { deriveEdgeHubOverlay, isHubArtefactId } from "./graph-edge-hubs";
import { emptyGraphLayout, withNodePosition } from "./graph-layout";
import { GRAPH_LAYOUT_VERSION } from "./graph-layout-file";
import { encodeGraphLayout } from "./graph-layout-files";
import { buildProjectGraphView } from "./graph-model";
import { graphOf, routeNode, tableNode } from "./graph-model.test-fixtures";
import { buildGraphScene, type GraphScenePalette } from "./graph-scene";
import {
  DEFAULT_GRAPH_VIEW_STATE,
  decodeGraphViewState,
  encodeGraphViewState,
} from "./graph-view-state";

const TASKS = tableNode("tasks");
const routes = Array.from({ length: 10 }, (_, index) => routeNode("GET", "/api/tasks/" + index));
const edges: GraphEdge[] = routes.map((route, index) => ({
  id: "route-table:" + index,
  kind: "route-table",
  source: route.id,
  target: TASKS.id,
  label: "dbTables",
}));
const view = buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });

const palette: GraphScenePalette = {
  background: "bg",
  card: "card",
  border: "border",
  text: "text",
  muted: "muted",
  outline: "outline",
  edges: {
    fk: { stroke: "fk", dashed: false },
    relation: { stroke: "relation", dashed: true },
    "route-table": { stroke: "route-table", dashed: false },
    "page-route": { stroke: "page-route", dashed: false },
    "page-link": { stroke: "page-link", dashed: false },
    "route-view": { stroke: "route-view", dashed: true },
    "view-base": { stroke: "view-base", dashed: true },
  },
  elevated: { stroke: "elevated", dashed: false },
};

describe("hubs never reach the AI scene", () => {
  it("the scene draws the real edges even while the canvas concentrates them", () => {
    // The overlay exists (the canvas would draw a hub)...
    const overlay = deriveEdgeHubOverlay(view, 4, new Set());
    expect(overlay.hubs).toHaveLength(1);
    // ...but the scene is built from the view, which the overlay never touches.
    const scene = buildGraphScene(view, emptyGraphLayout(), palette);
    expect(scene.nodes).toHaveLength(11);
    expect(scene.edges).toHaveLength(10);
    for (const node of scene.nodes) expect(isHubArtefactId(node.id)).toBe(false);
    for (const edge of scene.edges) expect(isHubArtefactId(edge.id)).toBe(false);
  });
});

describe("hubs never reach the exported layout", () => {
  it("encoding the layout the canvas commits writes no hub files and stays v3", () => {
    // The canvas commits positions only for real nodes (resolveDragCommit guards hubs);
    // the layout state is therefore exactly the view's nodes.
    let layout = emptyGraphLayout();
    for (const node of view.nodes) layout = withNodePosition(layout, node.id, node.position);
    const writes = encodeGraphLayout(layout);
    for (const write of writes) {
      expect(write.path.includes("hub:")).toBe(false);
      expect(write.path.includes("hub-edge:")).toBe(false);
    }
    const settings = writes.find((write) => write.path.endsWith("layout.json"));
    expect(settings).toBeDefined();
    expect(JSON.parse(settings?.contents ?? "{}").version).toBe(GRAPH_LAYOUT_VERSION);
    expect(GRAPH_LAYOUT_VERSION).toBe(3);
  });
});

describe("hubs never reach the URL state", () => {
  it("only the threshold is encoded; a hub id in selection/focus/collapsed is dropped", () => {
    const state = { ...DEFAULT_GRAPH_VIEW_STATE, edgeConcentration: 8 as const };
    const encoded = encodeGraphViewState(state);
    expect(encoded).toBe('{"e":8}');
    expect(encoded.includes("hub:")).toBe(false);

    const knownNodeIds = new Set(view.nodes.map((node) => node.id));
    const hostile = JSON.stringify({
      s: "hub:route-table:table:tasks",
      f: ["hub:route-table:table:tasks"],
      c: ["hub-edge:route-table:table:tasks"],
      e: 8,
    });
    const decoded = decodeGraphViewState(hostile, knownNodeIds);
    expect(decoded.selection).toBeNull();
    expect(decoded.focus).toEqual([]);
    expect(decoded.collapsed).toEqual([]);
    expect(decoded.edgeConcentration).toBe(8);
  });

  it("hostile threshold values degrade to the default 4", () => {
    for (const value of ['"banana"', "5", "null", "{}", "true", '"4"']) {
      const decoded = decodeGraphViewState('{"e":' + value + "}");
      expect(decoded.edgeConcentration).toBe(4);
    }
  });
});
