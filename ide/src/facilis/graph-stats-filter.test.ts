import { describe, expect, it } from "vitest";
import { GRAPH_EDGE_KINDS } from "./graph-types";
import {
  EMPTY_STATS_FILTER,
  effectiveHiddenEdgeKinds,
  isKindActive,
  toggleEdgesFilter,
  toggleKindFilter,
} from "./graph-stats-filter";

describe("graph stats filter", () => {
  it("starts empty: no kind isolated, edges shown", () => {
    expect(EMPTY_STATS_FILTER.kinds).toEqual([]);
    expect(EMPTY_STATS_FILTER.edgesHidden).toBe(false);
  });

  it("isolates a kind on first toggle and clears it on the second", () => {
    const one = toggleKindFilter(EMPTY_STATS_FILTER, "table");
    expect(one.kinds).toEqual(["table"]);
    expect(isKindActive(one, "table")).toBe(true);
    const none = toggleKindFilter(one, "table");
    expect(none.kinds).toEqual([]);
    expect(isKindActive(none, "table")).toBe(false);
  });

  it("accumulates several kinds and removes only the toggled one", () => {
    let filter = toggleKindFilter(EMPTY_STATS_FILTER, "page");
    filter = toggleKindFilter(filter, "route");
    expect(filter.kinds).toEqual(["page", "route"]);
    filter = toggleKindFilter(filter, "page");
    expect(filter.kinds).toEqual(["route"]);
  });

  it("toggles the edges counter independently of the kinds", () => {
    const hidden = toggleEdgesFilter(EMPTY_STATS_FILTER);
    expect(hidden.edgesHidden).toBe(true);
    expect(hidden.kinds).toEqual([]);
    expect(toggleEdgesFilter(hidden).edgesHidden).toBe(false);
  });

  it("keeps the layout's hidden edges when the edges counter is not pressed", () => {
    expect(effectiveHiddenEdgeKinds(EMPTY_STATS_FILTER, ["fk"])).toEqual(["fk"]);
  });

  it("hides every edge kind when the edges counter is pressed", () => {
    const hidden = toggleEdgesFilter(EMPTY_STATS_FILTER);
    expect(effectiveHiddenEdgeKinds(hidden, ["fk"])).toEqual([...GRAPH_EDGE_KINDS]);
  });
});
