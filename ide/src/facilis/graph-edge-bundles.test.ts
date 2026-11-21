// Issue #64 step 2: below-threshold fan-outs share one trunk lane, splitting only at the
// source ends. Every returned lane must keep ALL members collision-free (the router's
// invariant), and groups that cannot be bundled cleanly keep the normal router.
import { describe, expect, it } from "vitest";
import type { GraphEdge } from "@facilis.dev/analyze";
import {
  bundleTrunkPoints,
  deriveEdgeBundles,
  resolveTrunkGeometry,
} from "./graph-edge-bundles";
import { nodeRect, type Rect } from "./graph-edge-geometry";
import { MAX_EDGE_BENDS, countCardCollisions } from "./graph-edge-routing";
import { buildProjectGraphView } from "./graph-model";
import { graphOf, routeNode, tableNode } from "./graph-model.test-fixtures";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import type { ProjectGraphView } from "./graph-types";

const TASKS = tableNode("tasks");

function fanOut(count: number): ProjectGraphView {
  const routes = Array.from({ length: count }, (_, index) =>
    routeNode("GET", "/api/tasks/" + index),
  );
  const edges: GraphEdge[] = routes.map((route, index) => ({
    id: "route-table:" + index,
    kind: "route-table",
    source: route.id,
    target: TASKS.id,
    label: "dbTables",
  }));
  return buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
}

function rectsOf(view: ProjectGraphView): Rect[] {
  return view.nodes.map((node) => {
    const size = GRAPH_NODE_SIZES[node.kind];
    return nodeRect(node.position, size.width, size.height);
  });
}

function bendsOf(points: readonly { x: number; y: number }[]): number {
  let bends = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const before = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    if (before === undefined || prev === undefined || next === undefined) continue;
    const horizontalBefore = before.y === prev.y;
    const horizontalAfter = next.y === before.y;
    if (horizontalBefore !== horizontalAfter) bends += 1;
  }
  return bends;
}

describe("deriveEdgeBundles", () => {
  it("gives every member of a 3-route fan-out the SAME trunk lane", () => {
    const view = fanOut(3);
    const lanes = deriveEdgeBundles(view, 4);
    expect(lanes.size).toBe(3);
    const values = [...lanes.values()];
    expect(new Set(values).size).toBe(1);
  });

  it("trunk paths are orthogonal, within the bend budget and collision-free", () => {
    const view = fanOut(3);
    const lanes = deriveEdgeBundles(view, 4);
    const rects = rectsOf(view);
    const rectById = new Map(view.nodes.map((node, index) => [node.id, rects[index]]));
    const targetRect = rectById.get(TASKS.id);
    expect(targetRect).toBeDefined();
    if (targetRect === undefined) return;
    const trunks: string[] = [];
    for (const edge of view.edges) {
      const lane = lanes.get(edge.id);
      const sourceRect = rectById.get(edge.source);
      expect(lane).toBeDefined();
      expect(sourceRect).toBeDefined();
      if (lane === undefined || sourceRect === undefined) continue;
      const points = bundleTrunkPoints(sourceRect, targetRect, lane);
      expect(countCardCollisions(points, rects)).toBe(0);
      expect(bendsOf(points)).toBeLessThanOrEqual(MAX_EDGE_BENDS);
      // The shared trunk is the middle vertical segment: identical for every member.
      const a = points[1];
      const b = points[2];
      expect(a?.x).toBe(b?.x);
      trunks.push(String(a?.x));
    }
    expect(new Set(trunks).size).toBe(1);
  });

  it("does not bundle a single edge", () => {
    expect(deriveEdgeBundles(fanOut(1), 4).size).toBe(0);
  });

  it("leaves above-threshold groups to the hubs (expanded or not)", () => {
    const view = fanOut(10);
    expect(deriveEdgeBundles(view, 4).size).toBe(0);
    expect(deriveEdgeBundles(view, 8).size).toBe(0);
  });

  it("off disables bundling as well as hubs", () => {
    expect(deriveEdgeBundles(fanOut(3), "off").size).toBe(0);
  });

  it("skips a group whose corridor admits no clean lane", () => {
    // A wide blocker fills the whole corridor between the routes and the table: no lane can
    // keep the fan segments clean, so the group keeps the normal per-edge router.
    const routes = [routeNode("GET", "/api/a"), routeNode("GET", "/api/b")];
    const blocker = tableNode("blocker");
    const edges: GraphEdge[] = routes.map((route, index) => ({
      id: "route-table:" + index,
      kind: "route-table",
      source: route.id,
      target: TASKS.id,
      label: "dbTables",
    }));
    const base = buildProjectGraphView({ graph: graphOf([...routes, TASKS], edges) });
    const routeRight = Math.max(
      ...base.nodes
        .filter((node) => node.kind === "route")
        .map((node) => node.position.x + GRAPH_NODE_SIZES.route.width),
    );
    const target = base.nodes.find((node) => node.id === TASKS.id);
    expect(target).toBeDefined();
    if (target === undefined) return;
    // Pin the blocker across the corridor at both routes' heights via saved positions.
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of base.nodes) positions[node.id] = { ...node.position };
    const routeYs = base.nodes.filter((node) => node.kind === "route").map((n) => n.position.y);
    positions[blocker.id] = {
      x: routeRight + 2,
      y: Math.min(...routeYs) - 40,
    };
    const blocked = buildProjectGraphView({
      graph: graphOf([...routes, TASKS, blocker], edges),
      positions,
    });
    // The blocker spans the corridor at the first route's fan height, so NO lane keeps every
    // member clean: the whole group keeps the normal router instead of a partial trunk.
    expect(deriveEdgeBundles(blocked, 4).size).toBe(0);
  });
});

describe("resolveTrunkGeometry", () => {
  const source = nodeRect({ x: 0, y: 0 }, 256, 64);
  const target = nodeRect({ x: 600, y: 0 }, 240, 88);

  it("returns the shared trunk when the lane is clean", () => {
    const geometry = resolveTrunkGeometry(source, target, 428, null, [source, target]);
    expect(geometry).not.toBeNull();
    expect(geometry?.path.startsWith("M ")).toBe(true);
  });

  it("returns null when a measured card sits under the lane (router fallback)", () => {
    const blocker = nodeRect({ x: 400, y: -20 }, 60, 120);
    const geometry = resolveTrunkGeometry(source, target, 428, null, [source, target, blocker]);
    expect(geometry).toBeNull();
  });
});
