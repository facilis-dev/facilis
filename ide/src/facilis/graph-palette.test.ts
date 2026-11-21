// The palette ranker's contract (issue #68 criterion 1): the 500-node open budget measured
// with performance.now, exact-label-first ranking, prefix/fuzzy tiers, grouping and the empty
// query. Pure — no DOM, the ide/ pattern.

import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
  workflowNode,
} from "./graph-model.test-fixtures";
import {
  GRAPH_PALETTE_COMMANDS,
  PALETTE_MAX_RESULTS,
  buildPaletteIndex,
  flattenPaletteGroups,
  fuzzyScore,
  rankPalette,
} from "./graph-palette";
import type { ProjectGraphNode } from "./graph-types";

function viewNodes(): ProjectGraphNode[] {
  const graph = graphOf([
    pageNode("src/pages/todos.tsx"),
    routeNode("GET", "/api/todos"),
    routeNode("POST", "/api/todos"),
    tableNode("todos"),
    tableNode("projects"),
    viewNode("active_todos"),
    workflowNode("purge", [{ index: 0, kind: "job", name: "purge-job" }]),
  ]);
  return [...buildProjectGraphView({ graph }).nodes];
}

describe("buildPaletteIndex + rankPalette", () => {
  it("opens and ranks a 500-node index in under 100 ms (criterion 1)", () => {
    const nodes = [];
    for (let i = 0; i < 250; i += 1) {
      nodes.push(tableNode("table_" + i), routeNode("GET", "/api/resource-" + i));
    }
    const view = buildProjectGraphView({ graph: graphOf(nodes) });
    const start = performance.now();
    const index = buildPaletteIndex(view.nodes);
    const groups = rankPalette(index, "resource-12");
    const elapsed = performance.now() - start;
    expect(view.nodes.length).toBe(500);
    expect(elapsed).toBeLessThan(100);
    expect(groups.length).toBeGreaterThan(0);
    // Evidence for the PR description: the measured open budget on this machine.
    console.log(`palette 500-node index+rank: ${elapsed.toFixed(2)} ms`);
  });

  it("ranks an exact label match first, ahead of prefixes and fuzzy hits", () => {
    const index = buildPaletteIndex(viewNodes());
    const flat = flattenPaletteGroups(rankPalette(index, "todos"));
    const nodes = flat.filter((entry) => entry.type === "node");
    expect(nodes[0]).toMatchObject({ type: "node", label: "todos" });
    // The page path and route paths contain "todos" too, but never outrank the exact label.
    const labels = nodes.map((entry) => (entry.type === "node" ? entry.label : ""));
    expect(labels.indexOf("todos")).toBe(0);
    expect(labels).toContain("GET /api/todos");
  });

  it("ranks label prefixes ahead of fuzzy subsequences", () => {
    const index = buildPaletteIndex(viewNodes());
    const flat = flattenPaletteGroups(rankPalette(index, "act"));
    const nodes = flat.filter((entry) => entry.type === "node");
    // "active_todos" starts with the query; no other label does, fuzzy hits follow.
    expect(nodes[0]).toMatchObject({ label: "active_todos" });
  });

  it("matches route paths and file paths, not only labels", () => {
    const index = buildPaletteIndex(viewNodes());
    const byRoute = flattenPaletteGroups(rankPalette(index, "/api/todos")).filter(
      (entry) => entry.type === "node",
    );
    expect(byRoute.length).toBeGreaterThanOrEqual(2);
    const byFile = flattenPaletteGroups(rankPalette(index, "db/schema")).filter(
      (entry) => entry.type === "node",
    );
    expect(byFile.length).toBeGreaterThan(0);
  });

  it("groups results by kind with commands first, in column order", () => {
    const index = buildPaletteIndex(viewNodes());
    const groups = rankPalette(index, "");
    expect(groups[0].kind).toBe("command");
    expect(groups[0].entries.length).toBe(GRAPH_PALETTE_COMMANDS.length);
    const kinds = groups.slice(1).map((group) => group.kind);
    expect(kinds).toEqual(["page", "route", "table", "view", "workflow"]);
    for (const group of groups.slice(1)) {
      for (const entry of group.entries) {
        expect(entry.type === "node" && entry.kind).toBe(group.kind);
      }
    }
  });

  it("lists every command and the capped node set on an empty query", () => {
    const nodes = [];
    for (let i = 0; i < 100; i += 1) nodes.push(tableNode("t" + i));
    const index = buildPaletteIndex(buildProjectGraphView({ graph: graphOf(nodes) }).nodes);
    const flat = flattenPaletteGroups(rankPalette(index, "   "));
    expect(flat.length).toBeLessThanOrEqual(PALETTE_MAX_RESULTS);
    expect(flat.filter((entry) => entry.type === "command").length).toBe(
      GRAPH_PALETTE_COMMANDS.length,
    );
  });

  it("returns no node group when nothing matches, keeping unmatched commands out", () => {
    const index = buildPaletteIndex(viewNodes());
    const groups = rankPalette(index, "zzzz-no-such-thing");
    expect(groups.every((group) => group.kind === "command")).toBe(true);
    expect(flattenPaletteGroups(groups).length).toBe(0);
  });

  it("ships one isolate command per edge kind plus the four actions", () => {
    const ids = GRAPH_PALETTE_COMMANDS.map((command) => command.id);
    expect(ids).toContain("fit");
    expect(ids).toContain("reset-layout");
    expect(ids).toContain("toggle-matrix");
    expect(ids).toContain("save-layout");
    expect(ids).toContain("isolate-edge:route-table");
    expect(ids.filter((id) => id.startsWith("isolate-edge:")).length).toBe(7);
  });
});

describe("fuzzyScore", () => {
  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "todos")).toBeNull();
    expect(fuzzyScore("sodot", "todos")).toBeNull();
  });

  it("prefers compact leading matches over spread ones", () => {
    const compact = fuzzyScore("td", "todos");
    const spread = fuzzyScore("td", "t____d");
    expect(compact).not.toBeNull();
    expect(spread).not.toBeNull();
    expect(compact as number).toBeLessThan(spread as number);
  });

  it("scores an empty query as zero", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});
