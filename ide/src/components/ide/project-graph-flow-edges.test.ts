// The edge mapper (issue #65): bridge specs and hover-isolation dimming ride on edge data.
import { describe, expect, it, vi } from "vitest";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import type { ProjectGraphEdge } from "@/facilis/graph-types";
import { buildProjectGraphFlowEdges } from "./project-graph-flow-edges";

const spec = (edgeId: string): BridgeSpec => ({
  edgeId,
  side: "above",
  source: { x: 0, y: 0 },
  target: { x: 100, y: 0 },
  control: { x: 24, y: -96 },
  apex: { x: 37, y: -48 },
  radius: 48,
  label: null,
});

const edges: ProjectGraphEdge[] = [
  { id: "a", kind: "fk", source: "s", target: "t", label: null },
  { id: "b", kind: "relation", source: "s", target: "t", label: "one" },
];

const input = {
  edges,
  edgeCurves: {},
  selectedEdgeId: null,
  focus: null,
  bridges: new Map([
    ["a", spec("a")],
    ["b", { ...spec("b"), label: "one" }],
  ]),
  hoveredBridgeId: null,
  onCurveChange: vi.fn(),
  onBridgeHover: vi.fn(),
};

describe("buildProjectGraphFlowEdges", () => {
  it("attaches the bridge spec and the hover callback to bridged edges", () => {
    const flow = buildProjectGraphFlowEdges(input);
    expect(flow[0]?.data?.bridge?.edgeId).toBe("a");
    expect(flow[1]?.data?.bridge?.label).toBe("one");
    expect(flow[0]?.data?.onBridgeHover).toBe(input.onBridgeHover);
    expect(flow[0]?.data?.bridgeDimmed).toBe(false);
  });

  it("dims every bridge except the hovered one (criterion 4)", () => {
    const flow = buildProjectGraphFlowEdges({ ...input, hoveredBridgeId: "a" });
    expect(flow[0]?.data?.bridgeDimmed).toBe(false);
    expect(flow[1]?.data?.bridgeDimmed).toBe(true);
  });

  it("never dims a non-bridge edge through the bridge state", () => {
    const flow = buildProjectGraphFlowEdges({
      ...input,
      bridges: new Map([["a", spec("a")]]),
      hoveredBridgeId: "a",
    });
    expect(flow[1]?.data?.bridge).toBeNull();
    expect(flow[1]?.data?.bridgeDimmed).toBe(false);
  });

  it("keeps curves and focus dimming as they were", () => {
    const flow = buildProjectGraphFlowEdges({
      ...input,
      edgeCurves: { a: { x: 4, y: 2 } },
      selectedEdgeId: "b",
    });
    expect(flow[0]?.data?.curve).toEqual({ x: 4, y: 2 });
    expect(flow[1]?.selected).toBe(true);
  });
});
