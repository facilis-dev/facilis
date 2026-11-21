import { describe, expect, it } from "vitest";
import { nodeRect, type Point, type Rect } from "./graph-edge-geometry";
import {
  MAX_EDGE_BENDS,
  countCardCollisions,
  routeEdge,
  segmentHitsRect,
} from "./graph-edge-routing";
import { buildProjectGraphView } from "./graph-model";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import { exampleProjectGraph } from "./graph-layout.test-fixtures";

const rect = (width: number, height: number, x = 0, y = 0): Rect =>
  nodeRect({ x, y }, width, height);

/** Parse an orthogonal "M x y L x y ..." path back into its points. */
function parsePath(path: string): Point[] {
  return path.split(/(?=[ML])/u).map((part) => {
    const [x, y] = part.trim().slice(1).trim().split(" ").map(Number);
    return { x, y };
  });
}

function bendsOf(points: readonly Point[]): number {
  let bends = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const horizontalBefore = points[i].y === points[i - 1].y;
    const horizontalAfter = points[i + 1].y === points[i].y;
    if (horizontalBefore !== horizontalAfter) bends += 1;
  }
  return bends;
}

function expectOrthogonal(points: readonly Point[]): void {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    expect(a.x === b.x || a.y === b.y).toBe(true);
  }
}

describe("segmentHitsRect", () => {
  const card = rect(100, 50, 100, 100);

  it("detects a segment passing under the card", () => {
    expect(segmentHitsRect({ x: 50, y: 125 }, { x: 250, y: 125 }, card)).toBe(true);
    expect(segmentHitsRect({ x: 150, y: 50 }, { x: 150, y: 200 }, card)).toBe(true);
  });

  it("clears a segment that only touches the inflated border", () => {
    expect(segmentHitsRect({ x: 50, y: 97 }, { x: 250, y: 97 }, card)).toBe(false);
    expect(segmentHitsRect({ x: 50, y: 125 }, { x: 97, y: 125 }, card)).toBe(false);
  });

  it("clears a segment outside the card", () => {
    expect(segmentHitsRect({ x: 50, y: 300 }, { x: 250, y: 300 }, card)).toBe(false);
  });
});

describe("routeEdge", () => {
  const source = rect(240, 80, 0, 0);
  const target = rect(240, 80, 400, 0);

  it("routes a clean horizontal edge straight between the ports", () => {
    const geometry = routeEdge(source, target, { obstacles: [source, target] });
    const points = parsePath(geometry.path);
    expectOrthogonal(points);
    expect(countCardCollisions(points, [source, target])).toBe(0);
    expect(bendsOf(points)).toBeLessThanOrEqual(MAX_EDGE_BENDS);
  });

  it("routes around a card sitting between the endpoints", () => {
    const blocker = rect(240, 80, 300, -20);
    const far = rect(240, 80, 600, 0);
    const geometry = routeEdge(source, far, { obstacles: [source, blocker, far] });
    const points = parsePath(geometry.path);
    expectOrthogonal(points);
    expect(countCardCollisions(points, [source, blocker, far])).toBe(0);
    expect(bendsOf(points)).toBeLessThanOrEqual(MAX_EDGE_BENDS);
  });

  it("moves the midpoint by exactly the curve offset and stays orthogonal", () => {
    const options = { obstacles: [source, target] };
    const flat = routeEdge(source, target, options);
    const bent = routeEdge(source, target, { ...options, curve: { x: 12, y: -30 } });
    expect(bent.midpoint).toEqual({ x: flat.midpoint.x + 12, y: flat.midpoint.y - 30 });
    expectOrthogonal(parsePath(bent.path));
    expect(countCardCollisions(parsePath(bent.path), [source, target])).toBe(0);
  });

  it("is deterministic", () => {
    const options = { obstacles: [source, target] };
    expect(routeEdge(source, target, options)).toEqual(routeEdge(source, target, options));
  });
});

describe("the example graph routes without crossing a card", () => {
  const view = buildProjectGraphView({ graph: exampleProjectGraph() });
  const rects = new Map(
    view.nodes.map((node) => {
      const size = GRAPH_NODE_SIZES[node.kind];
      return [node.id, nodeRect(node.position, size.width, size.height)] as const;
    }),
  );
  const obstacles = [...rects.values()];

  it("every edge stays orthogonal, within the bend budget, and clear of every card", () => {
    expect(view.edges.length).toBeGreaterThan(50);
    for (const edge of view.edges) {
      const sourceRect = rects.get(edge.source);
      const targetRect = rects.get(edge.target);
      expect(sourceRect, edge.id).toBeDefined();
      expect(targetRect, edge.id).toBeDefined();
      if (sourceRect === undefined || targetRect === undefined) continue;
      const geometry = routeEdge(sourceRect, targetRect, { obstacles });
      const points = parsePath(geometry.path);
      expectOrthogonal(points);
      expect(countCardCollisions(points, obstacles), edge.id).toBe(0);
      expect(bendsOf(points), edge.id).toBeLessThanOrEqual(MAX_EDGE_BENDS);
    }
  });

  it("routes the same graph identically on a second run", () => {
    const paths = view.edges.map((edge) => {
      const sourceRect = rects.get(edge.source);
      const targetRect = rects.get(edge.target);
      if (sourceRect === undefined || targetRect === undefined) return "";
      return routeEdge(sourceRect, targetRect, { obstacles }).path;
    });
    const again = view.edges.map((edge) => {
      const sourceRect = rects.get(edge.source);
      const targetRect = rects.get(edge.target);
      if (sourceRect === undefined || targetRect === undefined) return "";
      return routeEdge(sourceRect, targetRect, { obstacles }).path;
    });
    expect(again).toEqual(paths);
  });
});