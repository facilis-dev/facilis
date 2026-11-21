import { describe, expect, it } from "vitest";
import { nodeRect, type Rect } from "./graph-edge-geometry";
import { bridgeClearsCards, BRIDGE_CLEARANCE } from "./graph-bridge-clearance";
import {
  BRIDGE_BASE_LIFT,
  BRIDGE_LENGTH_THRESHOLD,
  BRIDGE_RADIUS_STEP,
  planGraphBridges,
  shouldBridgeRoute,
} from "./graph-edge-bridges";
import {
  BRIDGE_LABEL_FONT_PX,
  BRIDGE_MIN_TEXT_PX,
  bridgeGeometry,
  bridgeLabelFontPx,
  bridgeLabelVisible,
  quadraticPoint,
  shiftBridgeSpec,
  type BridgeSpec,
} from "./graph-bridge-geometry";
import { segmentHitsRect } from "./graph-edge-routing";
import { buildProjectGraphView } from "./graph-model";
import { GRAPH_CARD_SIZES } from "./graph-layout-engine";
import { exampleProjectGraph } from "./graph-layout.test-fixtures";

const rect = (width: number, height: number, x = 0, y = 0): Rect =>
  nodeRect({ x, y }, width, height);

function exampleRects(): {
  view: ReturnType<typeof buildProjectGraphView>;
  rects: Map<string, Rect>;
} {
  const view = buildProjectGraphView({ graph: exampleProjectGraph() });
  const rects = new Map(
    view.nodes.map((node) => {
      const size = GRAPH_CARD_SIZES[node.kind];
      return [node.id, nodeRect(node.position, size.width, size.height)] as const;
    }),
  );
  return { view, rects };
}

/** Dense independent sampling: a second opinion on the sound clearance proof. */
function sampledClearance(spec: BridgeSpec, obstacles: readonly Rect[]): boolean {
  const samples = 512;
  for (let i = 0; i <= samples; i += 1) {
    const point = quadraticPoint(spec.source, spec.control, spec.target, i / samples);
    for (const card of obstacles) {
      const left = card.center.x - card.width / 2 - BRIDGE_CLEARANCE;
      const right = card.center.x + card.width / 2 + BRIDGE_CLEARANCE;
      const top = card.center.y - card.height / 2 - BRIDGE_CLEARANCE;
      const bottom = card.center.y + card.height / 2 + BRIDGE_CLEARANCE;
      if (point.x > left && point.x < right && point.y > top && point.y < bottom) return false;
    }
  }
  return true;
}

describe("planGraphBridges on the example project", () => {
  const { view, rects } = exampleRects();
  const obstacles = [...rects.values()];
  const plan = planGraphBridges({ edges: view.edges, rects, curves: {}, enabled: true });

  it("bridges the long edges whose straight path would cross a card (criterion 1)", () => {
    expect(view.edges.length).toBeGreaterThan(50);
    expect(plan.size).toBeGreaterThan(0);
    // The longest edge of the example: a route reading a view three layers away.
    expect(plan.has("route-view:2")).toBe(true);
    const bridged = view.edges.filter((edge) => plan.has(edge.id));
    for (const edge of bridged) {
      const source = rects.get(edge.source);
      const target = rects.get(edge.target);
      expect(source, edge.id).toBeDefined();
      expect(target, edge.id).toBeDefined();
      if (source === undefined || target === undefined) continue;
      const crosses = obstacles.some(
        (card) =>
          card !== source &&
          card !== target &&
          segmentHitsRect(source.center, target.center, card, 0),
      );
      expect(crosses, edge.id).toBe(true);
    }
  });

  it("keeps the direct orthogonal route for short neighbour edges", () => {
    // A page and its own route sit side by side: the clean short route wins.
    expect(plan.has("page-route:4:POST")).toBe(false);
    expect(plan.has("fk:5")).toBe(false);
    for (const edge of view.edges) {
      if (edge.source === edge.target) expect(plan.has(edge.id)).toBe(false);
    }
  });

  it("never lets a bridge intersect a card rectangle (criterion 2, all edges)", () => {
    for (const edge of view.edges) {
      const spec = plan.get(edge.id);
      if (spec === undefined) continue;
      expect(bridgeClearsCards(spec.source, spec.control, spec.target, obstacles), edge.id).toBe(
        true,
      );
      expect(sampledClearance(spec, obstacles), edge.id).toBe(true);
      // The apex sits outside the band, on the side the spec names.
      const bandTop = Math.min(...obstacles.map((r) => r.center.y - r.height / 2));
      const bandBottom = Math.max(...obstacles.map((r) => r.center.y + r.height / 2));
      if (spec.side === "above")
        expect(spec.apex.y).toBeLessThanOrEqual(bandTop - BRIDGE_BASE_LIFT);
      else expect(spec.apex.y).toBeGreaterThanOrEqual(bandBottom + BRIDGE_BASE_LIFT);
    }
  });

  it("stagger radii of bridges sharing a corridor (criterion 3)", () => {
    const specs = [...plan.values()];
    for (const a of specs) {
      for (const b of specs) {
        if (a.edgeId >= b.edgeId || a.side !== b.side) continue;
        const aStart = Math.min(a.source.x, a.target.x);
        const aEnd = Math.max(a.source.x, a.target.x);
        const bStart = Math.min(b.source.x, b.target.x);
        const bEnd = Math.max(b.source.x, b.target.x);
        if (aStart <= bEnd && bStart <= aEnd) {
          expect(a.radius, a.edgeId + " vs " + b.edgeId).not.toBe(b.radius);
        }
      }
    }
  });

  it("is deterministic and independent of edge input order", () => {
    const again = planGraphBridges({ edges: view.edges, rects, curves: {}, enabled: true });
    expect([...again.entries()]).toEqual([...plan.entries()]);
    const shuffled = planGraphBridges({
      edges: view.edges.toReversed(),
      rects,
      curves: {},
      enabled: true,
    });
    expect([...shuffled.entries()]).toEqual([...plan.entries()]);
  });

  it("restores the orthogonal lens when disabled (criterion 5)", () => {
    const off = planGraphBridges({ edges: view.edges, rects, curves: {}, enabled: false });
    expect(off.size).toBe(0);
  });

  it("keeps orthogonal rendering for edges with a saved user curve", () => {
    const bridgedId = [...plan.keys()][0];
    expect(bridgedId).toBeDefined();
    if (bridgedId === undefined) return;
    const curved = planGraphBridges({
      edges: view.edges,
      rects,
      curves: { [bridgedId]: { x: 10, y: -4 } },
      enabled: true,
    });
    expect(curved.has(bridgedId)).toBe(false);
    // The rest of the plan is untouched: one curve unbundles only its own edge.
    expect(curved.size).toBe(plan.size - 1);
  });
});

describe("corridor staggering on a synthetic corridor", () => {
  const rects = new Map<string, Rect>();
  const edges = [0, 1, 2].map((index) => {
    const y = index * 100;
    rects.set("s" + index, rect(240, 80, 0, y));
    rects.set("t" + index, rect(240, 80, 2000, y));
    return { id: "e" + index, source: "s" + index, target: "t" + index, label: "link " + index };
  });
  // A ballast card far below keeps the band's centre under all three edges, so they share
  // the above corridor; it sits outside every route and every arc.
  rects.set("ballast", rect(240, 80, 900, 1000));
  const plan = planGraphBridges({ edges, rects, curves: {}, enabled: true });

  it("gives three parallel bridges three distinct radii in the base stagger", () => {
    expect(plan.size).toBe(3);
    const radii = edges.map((edge) => plan.get(edge.id)?.radius);
    expect(radii).toEqual([
      BRIDGE_BASE_LIFT,
      BRIDGE_BASE_LIFT + BRIDGE_RADIUS_STEP,
      BRIDGE_BASE_LIFT + 2 * BRIDGE_RADIUS_STEP,
    ]);
    for (const edge of edges) {
      const spec = plan.get(edge.id);
      expect(spec?.label).toBe(edge.label);
      expect(spec?.side).toBe("above");
      // Apex at t = 0.5 with the control in the source port gap (246 + 24), one radius up.
      expect(spec?.apex.x).toBe((246 + 2 * 270 + 1994) / 4);
      expect(spec?.apex.y).toBe(-(spec?.radius ?? 0));
    }
  });

  it("parks the apex at t = 0.5 of the quadratic and shapes a Q path", () => {
    const spec = plan.get("e0");
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    const apex = quadraticPoint(spec.source, spec.control, spec.target, 0.5);
    expect(apex.x).toBeCloseTo(spec.apex.x, 6);
    expect(apex.y).toBeCloseTo(spec.apex.y, 6);
    const geometry = bridgeGeometry(spec);
    expect(geometry.path).toMatch(/^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? Q /u);
    expect(geometry.midpoint).toEqual(spec.apex);
    const shifted = shiftBridgeSpec(spec, { x: -100, y: 50 });
    expect(shifted.apex).toEqual({ x: spec.apex.x - 100, y: spec.apex.y + 50 });
    expect(shifted.radius).toBe(spec.radius);
  });
});

describe("bridge detection rules", () => {
  it("bridges a long route or a colliding one, and never a short clean route", () => {
    expect(shouldBridgeRoute(BRIDGE_LENGTH_THRESHOLD + 1, 0)).toBe(true);
    expect(shouldBridgeRoute(BRIDGE_LENGTH_THRESHOLD, 0)).toBe(false);
    expect(shouldBridgeRoute(100, 1)).toBe(true);
    expect(shouldBridgeRoute(100, 0)).toBe(false);
  });

  it("bridges a long detour around a wall between the endpoints", () => {
    // The router climbs over the wall; the rendered detour exceeds the threshold.
    const source = rect(240, 80, 0, 0);
    const target = rect(240, 80, 900, 0);
    const wall = rect(60, 800, 420, -360);
    const rects = new Map([
      ["s", source],
      ["t", target],
      ["w", wall],
    ]);
    const edges = [{ id: "e", source: "s", target: "t", label: null }];
    const plan = planGraphBridges({ edges, rects, curves: {}, enabled: true });
    const spec = plan.get("e");
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    expect(bridgeClearsCards(spec.source, spec.control, spec.target, [...rects.values()])).toBe(
      true,
    );
  });

  it("keeps the orthogonal route when no lift can clear the cards", () => {
    // Ceilings directly above and below the ports: every arc leaves into a card.
    const source = rect(240, 80, 0, 0);
    const target = rect(240, 80, 2000, 0);
    const ceiling = rect(4000, 2000, -1000, -2007);
    const floor = rect(4000, 2000, -1000, 87);
    const rects = new Map([
      ["s", source],
      ["t", target],
      ["c", ceiling],
      ["f", floor],
    ]);
    const edges = [{ id: "e", source: "s", target: "t", label: null }];
    const plan = planGraphBridges({ edges, rects, curves: {}, enabled: true });
    expect(plan.has("e")).toBe(false);
  });

  it("sends lower-half edges below the band", () => {
    const rects = new Map([
      ["s", rect(240, 80, 0, 900)],
      ["t", rect(240, 80, 2000, 900)],
      ["top", rect(240, 80, 900, 0)],
    ]);
    const edges = [{ id: "e", source: "s", target: "t", label: null }];
    const plan = planGraphBridges({ edges, rects, curves: {}, enabled: true });
    const spec = plan.get("e");
    expect(spec?.side).toBe("below");
    expect(spec?.apex.y).toBeGreaterThan(980);
    // Facing side ports: the arc leaves the source's right border at its centre height.
    expect(spec?.source.y).toBe(940);
    expect(spec?.source.x).toBe(246);
  });

  it("returns an empty plan for an empty graph", () => {
    expect(planGraphBridges({ edges: [], rects: new Map(), curves: {}, enabled: true }).size).toBe(
      0,
    );
  });
});

describe("apex label readability (epic rule 4, viewport-zoom adaptation)", () => {
  it("hides the label when it would render below 7 px", () => {
    expect(bridgeLabelVisible(1)).toBe(true);
    expect(bridgeLabelVisible(0.7)).toBe(true);
    expect(bridgeLabelVisible(0.63)).toBe(false);
    expect(bridgeLabelVisible(BRIDGE_MIN_TEXT_PX / BRIDGE_LABEL_FONT_PX)).toBe(true);
  });

  it("counter-scales a revealed label so it never renders under 7 px", () => {
    expect(bridgeLabelFontPx(1, false)).toBe(BRIDGE_LABEL_FONT_PX);
    expect(bridgeLabelFontPx(2, true)).toBe(BRIDGE_LABEL_FONT_PX);
    const lowZoom = 0.3;
    expect(bridgeLabelFontPx(lowZoom, true) * lowZoom).toBeCloseTo(BRIDGE_MIN_TEXT_PX, 6);
    // A degenerate zoom never divides by zero: it falls back to scale 1.
    expect(bridgeLabelFontPx(0, true)).toBe(BRIDGE_LABEL_FONT_PX);
  });
});

describe("bridgeClearsCards", () => {
  const card = rect(100, 50, 400, 100);

  it("rejects an arc passing through a card and accepts one flying over it", () => {
    const through: BridgeSpec = {
      edgeId: "e",
      side: "above",
      source: { x: 0, y: 125 },
      target: { x: 900, y: 125 },
      control: { x: 450, y: 125 },
      apex: { x: 450, y: 125 },
      radius: 0,
      label: null,
    };
    expect(bridgeClearsCards(through.source, through.control, through.target, [card])).toBe(false);
    const over: BridgeSpec = {
      ...through,
      control: { x: 450, y: -400 },
      apex: { x: 450, y: -87.5 },
    };
    expect(bridgeClearsCards(over.source, over.control, over.target, [card])).toBe(true);
    expect(sampledClearance(over, [card])).toBe(true);
  });

  it("treats touching the inflated border as clear, like the router", () => {
    const grazing: BridgeSpec = {
      edgeId: "e",
      side: "above",
      source: { x: 0, y: 97 },
      target: { x: 900, y: 97 },
      control: { x: 450, y: 97 },
      apex: { x: 450, y: 97 },
      radius: 0,
      label: null,
    };
    expect(bridgeClearsCards(grazing.source, grazing.control, grazing.target, [card])).toBe(true);
  });
});
