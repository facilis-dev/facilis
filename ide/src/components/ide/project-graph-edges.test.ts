import { describe, expect, it } from "vitest";

import {
  BRIDGE_DIM_OPACITY,
  ELEVATED_EDGE_STYLE,
  GRAPH_EDGE_LABEL_KEYS,
  GRAPH_EDGE_STYLES,
  edgeStyleFor,
} from "./project-graph-edges";

describe("project-graph edge styles", () => {
  it("keeps every edge kind styled", () => {
    for (const kind of [
      "fk",
      "relation",
      "route-table",
      "page-route",
      "page-link",
      "route-view",
      "view-base",
    ] as const) {
      expect(GRAPH_EDGE_STYLES[kind].stroke.length).toBeGreaterThan(0);
    }
  });

  it("uses one elevated style for every audited route-table and route-view edge", () => {
    expect(edgeStyleFor({ kind: "route-table" })).toBe(GRAPH_EDGE_STYLES["route-table"]);
    expect(edgeStyleFor({ kind: "route-table", access: "elevated" })).toBe(ELEVATED_EDGE_STYLE);
    expect(edgeStyleFor({ kind: "route-view" })).toBe(GRAPH_EDGE_STYLES["route-view"]);
    expect(edgeStyleFor({ kind: "route-view", access: "elevated" })).toBe(ELEVATED_EDGE_STYLE);
    expect(edgeStyleFor({ kind: "page-link" })).toBe(GRAPH_EDGE_STYLES["page-link"]);
  });
});

describe("bridge presentation (issue #65)", () => {
  it("dims isolated bridges with the same opacity as the focus dimming", () => {
    expect(BRIDGE_DIM_OPACITY).toBe(0.25);
  });

  it("re-exports the catalogue keys for the filters and the legend", () => {
    expect(GRAPH_EDGE_LABEL_KEYS.fk).toBe("projectGraph.edge.fk");
    expect(GRAPH_EDGE_LABEL_KEYS["route-view"]).toBe("projectGraph.edge.routeView");
  });
});
