import { describe, expect, it } from "vitest";
import { GRAPH_COLUMNS, buildProjectGraphView } from "./graph-model";
import { GET, PAGE, PROJECTS, TODOS, graphOf, tableNode } from "./graph-model.test-fixtures";

describe("buildProjectGraphView layout", () => {
  it("puts pages left, routes in the middle and tables right", () => {
    const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS, PROJECTS]) });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(PAGE.id)?.position).toEqual({ x: GRAPH_COLUMNS.page, y: 0 });
    expect(byId.get(GET.id)?.position).toEqual({ x: GRAPH_COLUMNS.route, y: 0 });
    expect(byId.get(TODOS.id)?.position.x).toBe(GRAPH_COLUMNS.table);
    expect(byId.get(PROJECTS.id)?.position.x).toBe(GRAPH_COLUMNS.table);
  });

  it("orders the table column by FK dependency, deterministically", () => {
    const graph = graphOf(
      [TODOS, PROJECTS],
      [{ id: "fk:1", kind: "fk", source: TODOS.id, target: PROJECTS.id, label: null }],
    );
    const view = buildProjectGraphView({ graph });
    const y = (id: string) => view.nodes.find((node) => node.id === id)?.position.y;
    expect(y(TODOS.id)).toBe(0);
    expect(y(PROJECTS.id)).toBeGreaterThan(0);
    expect(buildProjectGraphView({ graph })).toEqual(view);
  });

  it("keeps a deterministic row per node even in an FK cycle", () => {
    const a = tableNode("a");
    const b = tableNode("b");
    const graph = graphOf(
      [a, b],
      [
        { id: "fk:ab", kind: "fk", source: a.id, target: b.id, label: null },
        { id: "fk:ba", kind: "fk", source: b.id, target: a.id, label: null },
      ],
    );
    const view = buildProjectGraphView({ graph });
    expect(view.nodes.map((node) => node.id)).toEqual(["table:a", "table:b"]);
    expect(new Set(view.nodes.map((node) => node.position.y)).size).toBe(2);
  });

  it("applies saved positions over the automatic ones and ignores stale ids", () => {
    const view = buildProjectGraphView({
      graph: graphOf([PAGE, GET, TODOS]),
      positions: {
        [PAGE.id]: { x: 10, y: 20 },
        [GET.id]: { x: Number.NaN, y: 0 },
        "table:stale": { x: 999, y: 999 },
      },
    });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(PAGE.id)?.position).toEqual({ x: 10, y: 20 });
    expect(byId.get(GET.id)?.position).toEqual({ x: GRAPH_COLUMNS.route, y: 0 });
    expect(byId.has("table:stale")).toBe(false);
  });

  it("marks only tables as collapsed", () => {
    const view = buildProjectGraphView({
      graph: graphOf([PAGE, TODOS]),
      collapsed: { [PAGE.id]: true, [TODOS.id]: true },
    });
    expect(view.nodes.find((node) => node.id === PAGE.id)?.collapsed).toBe(false);
    expect(view.nodes.find((node) => node.id === TODOS.id)?.collapsed).toBe(true);
  });
});

describe("buildProjectGraphView search", () => {
  const graph = graphOf([PAGE, GET, TODOS, PROJECTS], []);

  it("matches labels, paths, permissions and column names", () => {
    for (const query of ["todos", "GET", "todos:read", "created_at"]) {
      const view = buildProjectGraphView({ graph, query });
      expect(view.stats.matches, query).toBeGreaterThan(0);
    }
    const none = buildProjectGraphView({ graph, query: "nothing-here" });
    expect(none.stats.matches).toBe(0);
    expect(none.nodes.every((node) => !node.matched)).toBe(true);
  });

  it("treats a blank query as matching everything", () => {
    const view = buildProjectGraphView({ graph, query: "   " });
    expect(view.stats.matches).toBe(view.nodes.length);
  });
});
