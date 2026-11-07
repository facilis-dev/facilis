import { describe, expect, it } from "vitest";

import { analyzeProject } from "./analyze.ts";
import { createOxcParser } from "./node.ts";
import { loadFixtureProject } from "../test-fixtures/load.ts";

function analyzeFixture() {
  return analyzeProject({ files: loadFixtureProject(), parser: createOxcParser() });
}

describe("analyzeProject (fixture)", () => {
  it("assembles the fact model end to end", () => {
    const analysis = analyzeFixture();
    expect(analysis.revision).toHaveLength(8);
    expect(analysis.config.parsed).toBe(true);
    expect(analysis.routes).toHaveLength(4);
    expect(analysis.tables.map((table) => table.name)).toEqual([
      "projects",
      "todos",
      "users",
      "sessions",
    ]);
    expect(analysis.relations).toHaveLength(2);
    expect(analysis.pages.filter((page) => page.calls.length > 0)).toHaveLength(3);
  });

  it("keeps invalid routes and unsafe client calls visible", () => {
    const analysis = analyzeFixture();
    const unsafe = analysis.routes.find((route) => route.path === "/api/unsafe");
    expect(unsafe?.wrapper).toBe("invalid");
    expect(analysis.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
      "client-transport",
      "route-wrapper",
    ]);
  });

  it("builds the single project graph from the facts", () => {
    const analysis = analyzeFixture();
    const nodeKinds = analysis.graph.nodes.map((node) => node.kind);
    expect(nodeKinds.filter((kind) => kind === "table")).toHaveLength(4);
    expect(nodeKinds.filter((kind) => kind === "route")).toHaveLength(4);
    expect(nodeKinds.filter((kind) => kind === "page")).toHaveLength(3);
    expect(new Set(analysis.graph.edges.map((edge) => edge.kind))).toEqual(
      new Set(["fk", "relation", "route-table", "page-route"]),
    );
  });
});
