import { describe, expect, it } from "vitest";
import { buildProjectGraphView } from "./graph-model";
import { GRAPH_ROW_PITCH, GRAPH_VIEW_GAP } from "./graph-layout-engine";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  PROJECTS,
  TODOS,
  WORKFLOW,
  graphOf,
  routeNode,
  tableNode,
  viewNode,
} from "./graph-model.test-fixtures";

describe("buildProjectGraphView layout", () => {
  it("keeps the layer order pages, routes, schema objects, workflows left to right", () => {
    const view = buildProjectGraphView({
      graph: graphOf([PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS, WORKFLOW]),
    });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    const x = (id: string) => byId.get(id)?.position.x ?? Number.NaN;
    const y = (id: string) => byId.get(id)?.position.y ?? Number.NaN;
    expect(x(PAGE.id)).toBeLessThan(x(GET.id));
    expect(x(GET.id)).toBeLessThan(x(TODOS.id));
    // Views are schema objects: they share the data layer's column with the tables.
    expect(x(ACTIVE_TODOS.id)).toBe(x(TODOS.id));
    expect(x(PROJECTS.id)).toBe(x(TODOS.id));
    expect(x(TODOS.id)).toBeLessThan(x(WORKFLOW.id));
    // A small graph stays one sub-column per layer, so every layer starts at the top.
    // Without FK edges the tables tie-break lexicographically: projects before todos.
    expect(y(PAGE.id)).toBe(0);
    expect(y(GET.id)).toBe(0);
    expect(y(PROJECTS.id)).toBe(0);
    expect(y(TODOS.id)).toBe(GRAPH_ROW_PITCH.table);
    expect(y(WORKFLOW.id)).toBe(0);
  });

  it("lays views in the data layer below the tables, behind a gap", () => {
    const graph = graphOf([TODOS, ACTIVE_TODOS]);
    const view = buildProjectGraphView({ graph });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(TODOS.id)?.position).toEqual({ x: 0, y: 0 });
    expect(byId.get(ACTIVE_TODOS.id)?.position).toEqual({
      x: 0,
      y: GRAPH_ROW_PITCH.table + GRAPH_VIEW_GAP,
    });
    expect(buildProjectGraphView({ graph })).toEqual(view);
  });

  it("orders the view rows deterministically by name", () => {
    const alpha = viewNode("alpha");
    const beta = viewNode("beta");
    const view = buildProjectGraphView({ graph: graphOf([beta, alpha]) });
    const byName = new Map(view.nodes.map((node) => [node.label, node.position]));
    expect(byName.get("alpha")).toEqual({ x: 0, y: 0 });
    expect(byName.get("beta")).toEqual({ x: 0, y: GRAPH_ROW_PITCH.view });
    expect(buildProjectGraphView({ graph: graphOf([beta, alpha]) })).toEqual(view);
  });

  it("orders the workflow layer deterministically by name", () => {
    const alpha = { ...WORKFLOW, id: "workflow:alpha", label: "alpha" };
    const beta = { ...WORKFLOW, id: "workflow:beta", label: "beta" };
    const view = buildProjectGraphView({ graph: graphOf([beta, alpha]) });
    const byName = new Map(view.nodes.map((node) => [node.label, node.position]));
    expect(byName.get("alpha")).toEqual({ x: 0, y: 0 });
    expect(byName.get("beta")).toEqual({ x: 0, y: GRAPH_ROW_PITCH.workflow });
  });

  it("leaves room for the taller route card in the route layer", () => {
    const post = routeNode("POST", "/api/todos");
    const view = buildProjectGraphView({ graph: graphOf([GET, post]) });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(GET.id)?.position).toEqual({ x: 0, y: 0 });
    expect(byId.get(post.id)?.position).toEqual({ x: 0, y: GRAPH_ROW_PITCH.route });
  });

  it("orders the table layer by FK dependency, deterministically", () => {
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
    const graph = graphOf([PAGE, GET, TODOS]);
    const auto = buildProjectGraphView({ graph });
    const autoGet = auto.nodes.find((node) => node.id === GET.id)?.position;
    const view = buildProjectGraphView({
      graph,
      positions: {
        [PAGE.id]: { x: 10, y: 20 },
        [GET.id]: { x: Number.NaN, y: 0 },
        "table:stale": { x: 999, y: 999 },
      },
    });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get(PAGE.id)?.position).toEqual({ x: 10, y: 20 });
    expect(byId.get(GET.id)?.position).toEqual(autoGet);
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
  const graph = graphOf([PAGE, GET, TODOS, PROJECTS, ACTIVE_TODOS, WORKFLOW], []);

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
