import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import { GRAPH_ROW_PITCH, layoutGraph } from "./graph-layout-engine";
import { GRAPH_NODE_SIZES } from "./graph-node-size";
import { exampleProjectGraph, largeProjectGraph } from "./graph-layout.test-fixtures";
import { graphOf, routeNode } from "./graph-model.test-fixtures";

const routeLayer = (count: number) => ({
  rows: Array.from({ length: count }, (_unused, index) => {
    const node = routeNode("GET", "/api/r" + String(index).padStart(2, "0"));
    return { id: node.id, kind: node.kind };
  }),
});

describe("layoutGraph wrapping", () => {
  it("keeps a short layer in one sub-column", () => {
    const layout = layoutGraph([routeLayer(3)]);
    const xs = new Set([...layout.positions.values()].map((position) => position.x));
    expect(xs.size).toBe(1);
    expect(layout.height).toBeLessThanOrEqual(3 * GRAPH_ROW_PITCH.route);
  });

  it("wraps a tall layer into sub-columns and serpentines the reading order", () => {
    const layout = layoutGraph([routeLayer(30)]);
    const positions = [...layout.positions.entries()];
    const xs = [...new Set(positions.map(([, position]) => position.x))].toSorted((a, b) => a - b);
    expect(xs.length).toBeGreaterThan(1);
    // Serpentine: the first sub-column runs down, the next runs up, so both meet at the bottom
    // and the edge between neighbouring sub-columns stays short.
    const firstColumn = positions.filter(([, position]) => position.x === xs[0]);
    const secondColumn = positions.filter(([, position]) => position.x === xs[1]);
    const bottomOf = (column: typeof positions) =>
      Math.max(...column.map(([, position]) => position.y));
    expect(bottomOf(firstColumn)).toBe(bottomOf(secondColumn));
    // The wrapping keeps the box near 16:9 instead of a vertical ladder.
    expect(layout.width / layout.height).toBeGreaterThan(1);
  });

  it("keeps the layers in order left to right", () => {
    const pages = { rows: [{ id: "page:a", kind: "page" as const }] };
    const routes = routeLayer(2);
    const layout = layoutGraph([pages, routes]);
    const pageX = layout.positions.get("page:a")?.x ?? Number.NaN;
    for (const [id, position] of layout.positions) {
      if (id.startsWith("route:")) expect(position.x).toBeGreaterThan(pageX);
    }
  });

  it("reports the achieved bounding box of the auto positions", () => {
    const layout = layoutGraph([routeLayer(1)]);
    expect(layout.width).toBe(GRAPH_NODE_SIZES.route.width);
    expect(layout.height).toBe(GRAPH_NODE_SIZES.route.height);
  });

  it("returns an empty layout for an empty graph", () => {
    const layout = layoutGraph([{ rows: [] }]);
    expect(layout.positions.size).toBe(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });
});

describe("layoutGraph pinned positions", () => {
  it("overrides the auto position for a known id and ignores stale or non-finite ones", () => {
    const layers = [routeLayer(2)];
    const auto = layoutGraph(layers);
    const ids = [...auto.positions.keys()];
    const pinned = layoutGraph(layers, {
      [ids[0]]: { x: 123, y: 456 },
      [ids[1]]: { x: Number.NaN, y: 0 },
      "route:stale": { x: 9, y: 9 },
    });
    expect(pinned.positions.get(ids[0])).toEqual({ x: 123, y: 456 });
    expect(pinned.positions.get(ids[1])).toEqual(auto.positions.get(ids[1]));
    expect(pinned.positions.has("route:stale")).toBe(false);
    // The reported size is the auto layout's, not the overrides'.
    expect(pinned.width).toBe(auto.width);
    expect(pinned.height).toBe(auto.height);
  });
});

describe("the example project layout", () => {
  it("brings the bounding box close to 16:9 (between 1.3 and 2.0)", () => {
    const view = buildProjectGraphView({ graph: exampleProjectGraph() });
    const ratio = view.layoutSize.width / view.layoutSize.height;
    expect(ratio).toBeGreaterThanOrEqual(1.3);
    expect(ratio).toBeLessThanOrEqual(2.0);
  });

  it("is deterministic: same input, same output (snapshot)", () => {
    const graph = exampleProjectGraph();
    const first = buildProjectGraphView({ graph });
    const second = buildProjectGraphView({ graph });
    expect(second).toEqual(first);
    const positions = first.nodes
      .map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }))
      .toSorted((a, b) => a.id.localeCompare(b.id));
    expect(positions).toMatchSnapshot();
    expect(first.layoutSize).toMatchSnapshot();
  });

  it("lays 60 routes and 20 tables out in under 100 ms", () => {
    const graph = largeProjectGraph();
    const started = performance.now();
    const view = buildProjectGraphView({ graph });
    const elapsed = performance.now() - started;
    expect(view.nodes.length).toBe(89);
    expect(elapsed).toBeLessThan(100);
  });
});

describe("reset layout returns to the auto layout", () => {
  it("a view without saved positions equals the engine's auto positions", () => {
    const graph = graphOf([routeNode("GET", "/api/todos"), routeNode("POST", "/api/todos")]);
    const moved = buildProjectGraphView({
      graph,
      positions: { "route:GET /api/todos": { x: 500, y: 500 } },
    });
    const reset = buildProjectGraphView({ graph });
    expect(moved.nodes.find((node) => node.id === "route:GET /api/todos")?.position).toEqual({
      x: 500,
      y: 500,
    });
    const auto = layoutGraph([
      {
        rows: [
          { id: "route:GET /api/todos", kind: "route" },
          { id: "route:POST /api/todos", kind: "route" },
        ],
      },
    ]);
    for (const node of reset.nodes) {
      expect(node.position).toEqual(auto.positions.get(node.id));
    }
  });
});
