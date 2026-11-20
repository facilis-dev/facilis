import { describe, expect, it } from "vitest";
import {
  EDGE_ENDPOINT_GAP,
  SELF_LOOP_RADIUS,
  edgeGeometry,
  nodeRect,
  selfLoopGeometry,
  type Rect,
} from "./graph-edge-geometry";

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const CUBIC_PATH = new RegExp(
  String.raw`^M ${NUMBER} ${NUMBER} C ${NUMBER} ${NUMBER} ${NUMBER} ${NUMBER} ${NUMBER} ${NUMBER}$`,
);

const rect = (width: number, height: number, x = 0, y = 0): Rect => ({
  center: { x, y },
  width,
  height,
});

describe("nodeRect", () => {
  it("turns a top-left node position into a centred rect", () => {
    expect(nodeRect({ x: 10, y: 20 }, 100, 40)).toEqual({
      center: { x: 60, y: 40 },
      width: 100,
      height: 40,
    });
  });
});

describe("edgeGeometry", () => {
  const anchors = { source: { x: 0, y: 0 }, target: { x: 100, y: 0 } };

  it("renders a cubic path", () => {
    expect(edgeGeometry(anchors).path).toMatch(CUBIC_PATH);
  });

  it("puts the midpoint halfway between the anchors without a curve", () => {
    expect(edgeGeometry(anchors).midpoint).toEqual({ x: 50, y: 0 });
  });

  it("moves the midpoint by exactly the curve offset", () => {
    const curved = edgeGeometry(anchors, { x: 30, y: -20 });
    expect(curved.midpoint).toEqual({ x: 80, y: -20 });
    expect(curved.path).toMatch(CUBIC_PATH);
  });

  it("still renders a path when both anchors coincide", () => {
    const geometry = edgeGeometry({ source: { x: 10, y: 10 }, target: { x: 10, y: 10 } });
    expect(geometry.path).toMatch(CUBIC_PATH);
    expect(geometry.midpoint).toEqual({ x: 10, y: 10 });
  });
});

describe("selfLoopGeometry", () => {
  const card = rect(100, 40);
  const right = 50 + EDGE_ENDPOINT_GAP;

  it("renders a cubic loop to the right of the card", () => {
    expect(selfLoopGeometry(card).path).toMatch(CUBIC_PATH);
  });

  it("starts and ends on the right border and centres the midpoint there", () => {
    const geometry = selfLoopGeometry(card);
    expect(geometry.midpoint.y).toBe(0);
    expect(geometry.midpoint.x).toBeCloseTo(right + SELF_LOOP_RADIUS * 1.5);
  });

  it("moves the loop midpoint by exactly the curve offset", () => {
    const bent = selfLoopGeometry(card, { x: 12, y: -8 });
    const flat = selfLoopGeometry(card);
    expect(bent.midpoint.x).toBeCloseTo(flat.midpoint.x + 12);
    expect(bent.midpoint.y).toBeCloseTo(flat.midpoint.y - 8);
  });
});
