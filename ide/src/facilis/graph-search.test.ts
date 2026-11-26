// The incremental search match pass (issue #186): same matching semantics the model builder
// used to apply per keystroke, now a pure sweep over the cached nodes that never rebuilds or
// mutates them. Matches dim on the canvas; they never hide nodes.
import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model.ts";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  WORKFLOW,
  graphOf,
} from "./graph-model.test-fixtures.ts";
import { GRAPH_SEARCH_DEBOUNCE_MS, matchGraphNodes, normalizeGraphQuery } from "./graph-search.ts";

const graph = graphOf([PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS, WORKFLOW], []);
const view = buildProjectGraphView({ graph });

describe("matchGraphNodes", () => {
  it("matches labels, paths, permissions, column names, view and workflow facts", () => {
    for (const query of [
      "todos",
      "GET",
      "todos:read",
      "created_at",
      "active_todos",
      "definer",
      "purge",
      "tasks:decide",
    ]) {
      expect(matchGraphNodes(view.nodes, query).size, query).toBeGreaterThan(0);
    }
    expect(matchGraphNodes(view.nodes, "nothing-here").size).toBe(0);
  });

  it("treats a blank query as matching everything", () => {
    expect(matchGraphNodes(view.nodes, "   ").size).toBe(view.nodes.length);
    expect(matchGraphNodes(view.nodes, "").size).toBe(view.nodes.length);
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeGraphQuery("  TODOS ")).toBe("todos");
    expect(matchGraphNodes(view.nodes, "  TODOS ")).toEqual(matchGraphNodes(view.nodes, "todos"));
  });

  it("never rebuilds or mutates the model's node objects", () => {
    const nodesBefore = view.nodes;
    const first = view.nodes[0];
    const matched = matchGraphNodes(view.nodes, "todos");
    expect(matched.has(TODOS.id)).toBe(true);
    expect(matched.has(PROJECTS.id)).toBe(false);
    expect(view.nodes).toBe(nodesBefore);
    expect(view.nodes[0]).toBe(first);
    expect(view.nodes.every((node) => node.matched)).toBe(true);
  });

  it("exposes a debounce delay constant for the controller", () => {
    expect(GRAPH_SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});
