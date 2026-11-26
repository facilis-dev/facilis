// Selection focus regression tests (D-219, issue #187): a PAGE keeps its routes AND their
// tables/views bright (2 hops, so Q3 is visible on canvas); every other kind keeps one hop, and
// nothing outside the neighbourhood survives. Pure adjacency math, no DOM.

import { describe, expect, it } from "vitest";
import { buildNeighborIndex, focusHops, focusNeighborhood } from "./focus.ts";

const EDGES = [
  { source: "page", target: "route" },
  { source: "route", target: "table" },
  { source: "route", target: "view" },
  { source: "page", target: "linked-page" },
  { source: "linked-page", target: "linked-route" },
  { source: "linked-route", target: "three-hops" },
  { source: "orphan", target: "isolated" },
];

describe("neighbourhood focus", () => {
  it("indexes adjacency in both directions, sorted and deduped", () => {
    const index = buildNeighborIndex([
      { source: "a", target: "b" },
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ]);
    expect(index.get("a")).toEqual(["b"]);
    expect(index.get("b")).toEqual(["a", "c"]);
    expect(index.get("c")).toEqual(["b"]);
  });

  it("a page reaches two hops: routes and their tables/views", () => {
    const focused = focusNeighborhood(buildNeighborIndex(EDGES), "page", focusHops("page"));
    expect([...focused].toSorted()).toEqual([
      "linked-page",
      "linked-route",
      "page",
      "route",
      "table",
      "view",
    ]);
    // The third hop through the linked page is outside the boundary.
    expect(focused.has("three-hops")).toBe(false);
  });

  it("a route reaches only one hop", () => {
    const focused = focusNeighborhood(buildNeighborIndex(EDGES), "route", focusHops("route"));
    expect([...focused].toSorted()).toEqual(["page", "route", "table", "view"]);
  });

  it("an unrelated component stays outside the focus", () => {
    const focused = focusNeighborhood(buildNeighborIndex(EDGES), "page", focusHops("page"));
    expect(focused.has("orphan")).toBe(false);
    expect(focused.has("isolated")).toBe(false);
  });
});
