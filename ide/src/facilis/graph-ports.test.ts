import { describe, expect, it } from "vitest";
import { EDGE_ENDPOINT_GAP, nodeRect, type Rect } from "./graph-edge-geometry";
import { GRAPH_PORTS, nearestPortAnchors, portDirection, portPoint } from "./graph-ports";

const rect = (width: number, height: number, x = 0, y = 0): Rect =>
  nodeRect({ x, y }, width, height);

describe("portPoint", () => {
  const card = rect(100, 50, 10, 20);

  it.each([
    ["top", { x: 60, y: 20 }],
    ["bottom", { x: 60, y: 70 }],
    ["left", { x: 10, y: 45 }],
    ["right", { x: 110, y: 45 }],
  ] as const)("sits on the %s border midpoint", (port, expected) => {
    expect(portPoint(card, port)).toEqual(expected);
  });

  it("pushes the point outwards by the gap", () => {
    expect(portPoint(card, "right", EDGE_ENDPOINT_GAP)).toEqual({
      x: 110 + EDGE_ENDPOINT_GAP,
      y: 45,
    });
  });
});

describe("portDirection", () => {
  it("points outward for every port", () => {
    expect(portDirection("top")).toEqual({ x: 0, y: -1 });
    expect(portDirection("bottom")).toEqual({ x: 0, y: 1 });
    expect(portDirection("left")).toEqual({ x: -1, y: 0 });
    expect(portDirection("right")).toEqual({ x: 1, y: 0 });
  });
});

describe("nearestPortAnchors", () => {
  it("anchors a cross-link on the facing left/right ports", () => {
    const anchors = nearestPortAnchors(rect(100, 40, 0, 0), rect(100, 40, 300, 0));
    expect(anchors.sourcePort).toBe("right");
    expect(anchors.targetPort).toBe("left");
    expect(anchors.source).toEqual({ x: 100 + EDGE_ENDPOINT_GAP, y: 20 });
    expect(anchors.target).toEqual({ x: 300 - EDGE_ENDPOINT_GAP, y: 20 });
  });

  it("anchors a downward dependency on bottom/top", () => {
    const anchors = nearestPortAnchors(rect(100, 40, 0, 0), rect(100, 40, 0, 200));
    expect(anchors.sourcePort).toBe("bottom");
    expect(anchors.targetPort).toBe("top");
  });

  it("anchors a backward dependency on top/bottom", () => {
    const anchors = nearestPortAnchors(rect(100, 40, 0, 200), rect(100, 40, 0, 0));
    expect(anchors.sourcePort).toBe("top");
    expect(anchors.targetPort).toBe("bottom");
  });

  it("anchors a backwards cross-link on left/right", () => {
    const anchors = nearestPortAnchors(rect(100, 40, 300, 0), rect(100, 40, 0, 0));
    expect(anchors.sourcePort).toBe("left");
    expect(anchors.targetPort).toBe("right");
  });

  it("is deterministic and covers every port pair", () => {
    const source = rect(100, 40, 0, 0);
    const target = rect(100, 40, 120, 90);
    const first = nearestPortAnchors(source, target);
    expect(nearestPortAnchors(source, target)).toEqual(first);
    expect(GRAPH_PORTS).toContain(first.sourcePort);
    expect(GRAPH_PORTS).toContain(first.targetPort);
  });
});
