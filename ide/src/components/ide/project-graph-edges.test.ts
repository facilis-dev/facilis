import { describe, expect, it } from "vitest";

import {
  DATA_EDGE_STYLES,
  DATA_ELEVATED_STYLE,
  ELEVATED_EDGE_STYLE,
  GRAPH_EDGE_STYLES,
  dataEdgeStyleFor,
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
// ── data lens strokes (issue #70): stronger and pairwise distinct, never colour-only ─────

describe("data lens edge styles", () => {
  it("strengthens the four schema kinds and keeps the other kinds at base presentation", () => {
    for (const kind of ["fk", "relation", "route-view", "view-base"] as const) {
      expect(DATA_EDGE_STYLES[kind].width).toBeGreaterThan(1.5);
      expect(DATA_EDGE_STYLES[kind].stroke).toBe(GRAPH_EDGE_STYLES[kind].stroke);
    }
    for (const kind of ["route-table", "page-route", "page-link"] as const) {
      expect(DATA_EDGE_STYLES[kind].width).toBe(1.5);
      expect(DATA_EDGE_STYLES[kind].dash).toBeNull();
    }
  });

  it("gives every encoded stroke a distinct dash signature (no colour-only encoding)", () => {
    const signatures = [
      DATA_EDGE_STYLES.fk.dash,
      DATA_EDGE_STYLES.relation.dash,
      DATA_EDGE_STYLES["view-base"].dash,
      DATA_EDGE_STYLES["route-view"].dash,
      DATA_ELEVATED_STYLE.dash,
    ];
    expect(new Set(signatures).size).toBe(signatures.length);
    // fk is the solid one; elevated is dotted, distinct from every dash.
    expect(DATA_EDGE_STYLES.fk.dash).toBeNull();
    expect(DATA_ELEVATED_STYLE.dash).toBe("1 3");
  });

  it("lets an elevated edge win over its kind, whatever the kind", () => {
    expect(dataEdgeStyleFor({ kind: "route-table", access: "elevated" })).toBe(DATA_ELEVATED_STYLE);
    expect(dataEdgeStyleFor({ kind: "route-view", access: "elevated" })).toBe(DATA_ELEVATED_STYLE);
    expect(dataEdgeStyleFor({ kind: "fk" })).toBe(DATA_EDGE_STYLES.fk);
    expect(dataEdgeStyleFor({ kind: "view-base" })).toBe(DATA_EDGE_STYLES["view-base"]);
  });
});
