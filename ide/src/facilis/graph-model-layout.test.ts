import { describe, expect, it } from "vitest";
import { GRAPH_COLUMNS, buildProjectGraphView } from "./graph-model";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  graphOf,
  routeNode,
  tableNode,
  viewNode,
} from "./graph-model.test-fixtures";

describe("buildProjectGraphView layout", () => {
  it("puts pages left, routes in the middle and tables right", () => {
    const view = buildProjectGraphView({
      graph: graphOf([PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS]),
    });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(PAGE.id)?.position).toEqual({ x: GRAPH_COLUMNS.page, y: 0 });
    expect(byId.get(GET.id)?.position).toEqual({ x: GRAPH_COLUMNS.route, y: 0 });
    expect(byId.get(TODOS.id)?.position.x).toBe(GRAPH_COLUMNS.table);
    expect(byId.get(PROJECTS.id)?.position.x).toBe(GRAPH_COLUMNS.table);
    expect(byId.get(ACTIVE_TODOS.id)?.position.x).toBe(GRAPH_COLUMNS.table);
    expect(GRAPH_COLUMNS.view).toBe(GRAPH_COLUMNS.table);
  });

  it("lays views in the schema column below the tables, behind a gap", () => {
    const graph = graphOf([TODOS, ACTIVE_TODOS]);
    const view = buildProjectGraphView({ graph });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    // The table row pitch is 190; the first view row starts after it plus the 56px gap.
    expect(byId.get(TODOS.id)?.position).toEqual({ x: GRAPH_COLUMNS.table, y: 0 });
    expect(byId.get(ACTIVE_TODOS.id)?.position).toEqual({ x: GRAPH_COLUMNS.view, y: 246 });
    expect(buildProjectGraphView({ graph })).toEqual(view);
  });

  it("orders the view rows deterministically by name, after the tables", () => {
    const alpha = viewNode("alpha");
    const beta = viewNode("beta");
    const view = buildProjectGraphView({ graph: graphOf([TODOS, beta, alpha]) });
    const byName = new Map(view.nodes.map((node) => [node.label, node.position]));
    expect(byName.get("alpha")).toEqual({ x: GRAPH_COLUMNS.view, y: 246 });
    expect(byName.get("beta")).toEqual({ x: GRAPH_COLUMNS.view, y: 246 + 150 });
  });

  it("leaves room for the taller route card in the route column", () => {
    const post = routeNode("POST", "/api/todos");
    const view = buildProjectGraphView({ graph: graphOf([GET, post]) });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(GET.id)?.position).toEqual({ x: GRAPH_COLUMNS.route, y: 0 });
    expect(byId.get(post.id)?.position).toEqual({ x: GRAPH_COLUMNS.route, y: 112 });
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

  it("collapses tables and views, never pages or routes", () => {
    const view = buildProjectGraphView({
      graph: graphOf([PAGE, GET, TODOS, ACTIVE_TODOS]),
      collapsed: { [PAGE.id]: true, [GET.id]: true, [TODOS.id]: true, [ACTIVE_TODOS.id]: true },
    });
    expect(view.nodes.find((node) => node.id === PAGE.id)?.collapsed).toBe(false);
    expect(view.nodes.find((node) => node.id === GET.id)?.collapsed).toBe(false);
    expect(view.nodes.find((node) => node.id === TODOS.id)?.collapsed).toBe(true);
    expect(view.nodes.find((node) => node.id === ACTIVE_TODOS.id)?.collapsed).toBe(true);
  });
});

describe("buildProjectGraphView search", () => {
  const graph = graphOf([PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS], []);

  it("matches labels, paths, permissions, column names and view facts", () => {
    for (const query of ["todos", "GET", "todos:read", "created_at", "active_todos", "definer"]) {
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
