import { describe, expect, it } from "vitest";
import { subscribeGraphFocus, type GraphFocusRequest } from "@/facilis/graph-focus";
import { emptyGraphLayout, withNodePosition, type GraphLayoutFile } from "@/facilis/graph-layout";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { GET, PAGE, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import type { GraphScene, GraphScenePalette } from "@/facilis/graph-scene";
import type { GraphViewLoad } from "@/facilis/graph-view-load";
import type { IdeController } from "@/vv/controller";
import { createGraphViewAccess, type GraphViewAccessDeps } from "./graph-view-access";

const PAGE_ROUTE = {
  id: "page-route:1",
  kind: "page-route" as const,
  source: PAGE.id,
  target: GET.id,
  label: null,
};
const ROUTE_TABLE = {
  id: "route-table:1",
  kind: "route-table" as const,
  source: GET.id,
  target: TODOS.id,
  label: "dbTables",
};

const layout: GraphLayoutFile = withNodePosition(
  withNodePosition(withNodePosition(emptyGraphLayout(), PAGE.id, { x: 0, y: 0 }), GET.id, {
    x: 400,
    y: 0,
  }),
  TODOS.id,
  { x: 800, y: 200 },
);

const view = buildProjectGraphView({
  graph: graphOf([PAGE, GET, TODOS], [PAGE_ROUTE, ROUTE_TABLE]),
  positions: layout.nodes,
});

const PALETTE: GraphScenePalette = {
  background: "#fff",
  card: "#fafafa",
  border: "#ddd",
  text: "#111",
  muted: "#666",
  edges: {
    fk: { stroke: "#f00", dashed: false },
    relation: { stroke: "#0f0", dashed: true },
    "route-table": { stroke: "#00f", dashed: false },
    "page-route": { stroke: "#0ff", dashed: false },
    "page-link": { stroke: "#f0f", dashed: false },
    "route-view": { stroke: "#ff0", dashed: true },
    "view-base": { stroke: "#0f0", dashed: true },
  },
  elevated: { stroke: "#f80", dashed: false },
};

const EMPTY_LOAD: GraphViewLoad = {
  ok: true,
  view: buildProjectGraphView({ graph: graphOf([]) }),
  layout: emptyGraphLayout(),
};

interface HarnessState {
  opened: number;
  scenes: GraphScene[];
}

function harness(
  load: GraphViewLoad,
  overrides: Partial<GraphViewAccessDeps> = {},
): { access: ReturnType<typeof createGraphViewAccess>; state: HarnessState } {
  const state: HarnessState = { opened: 0, scenes: [] };
  const access = createGraphViewAccess({} as unknown as IdeController, {
    loadView: async () => load,
    palette: () => PALETTE,
    render: (scene: GraphScene) => {
      state.scenes.push(scene);
      return { dataUrl: "data:image/jpeg;base64,QUJD", width: 320, height: 200, bytes: 3 };
    },
    openGraph: () => {
      state.opened += 1;
    },
    ...overrides,
  });
  return { access, state };
}

function focusEvents(): { events: GraphFocusRequest[]; stop: () => void } {
  const events: GraphFocusRequest[] = [];
  const stop = subscribeGraphFocus((request) => events.push(request));
  // A request left pending by an earlier notification is replayed on subscribe, not this call.
  events.length = 0;
  return { events, stop };
}

describe("graph_view highlight", () => {
  it("validates ids against the visible view, focuses the known ones and reports unknown", async () => {
    const { access, state } = harness({ ok: true, view, layout });
    const focus = focusEvents();
    const result = await access.highlight({
      nodes: [PAGE.id, "table:missing"],
      edges: [ROUTE_TABLE.id, "edge:missing"],
      zoom: true,
    });
    focus.stop();
    expect(result).toEqual({
      ok: true,
      nodes: [PAGE.id],
      edges: [ROUTE_TABLE.id],
      unknown: ["edge:missing", "table:missing"],
    });
    expect(state.opened).toBe(1);
    expect(focus.events).toEqual([{ nodes: [PAGE.id], edges: [ROUTE_TABLE.id], zoom: true }]);
  });

  it("clears the focus for empty ids and keeps the viewport when zoom is false", async () => {
    const { access } = harness({ ok: true, view, layout });
    const focus = focusEvents();
    await access.highlight({ nodes: [], edges: [], zoom: false });
    focus.stop();
    expect(focus.events).toEqual([{ nodes: [], edges: [], zoom: false }]);
  });

  it("reports a closed project as data and opens nothing", async () => {
    const { access, state } = harness({ ok: false, reason: "no_project" });
    const focus = focusEvents();
    expect(await access.highlight({ nodes: [], edges: [], zoom: true })).toEqual({
      ok: false,
      reason: "no_project",
    });
    focus.stop();
    expect(state.opened).toBe(0);
    expect(focus.events).toEqual([]);
  });
});

describe("graph_view paths", () => {
  it("returns the fewest-hop undirected path and focuses the union of all paths", async () => {
    const { access, state } = harness({ ok: true, view, layout });
    const focus = focusEvents();
    const result = await access.paths({
      from: PAGE.id,
      to: TODOS.id,
      maxPaths: 5,
      maxHops: 12,
      highlight: true,
    });
    focus.stop();
    expect(result).toEqual({
      ok: true,
      paths: [{ nodes: [PAGE.id, GET.id, TODOS.id], edges: [PAGE_ROUTE.id, ROUTE_TABLE.id] }],
      unknown: [],
    });
    expect(state.opened).toBe(1);
    expect(focus.events).toHaveLength(1);
    expect(focus.events[0]?.nodes).toHaveLength(3);
    expect(focus.events[0]?.edges).toHaveLength(2);
    expect(focus.events[0]?.zoom).toBe(true);
  });

  it("does not open or focus the graph when highlight is false", async () => {
    const { access, state } = harness({ ok: true, view, layout });
    const focus = focusEvents();
    await access.paths({
      from: PAGE.id,
      to: GET.id,
      maxPaths: 5,
      maxHops: 12,
      highlight: false,
    });
    focus.stop();
    expect(state.opened).toBe(0);
    expect(focus.events).toEqual([]);
  });

  it("returns an unknown id instead of a made-up path", async () => {
    const { access } = harness({ ok: true, view, layout });
    expect(
      await access.paths({
        from: "page:missing",
        to: TODOS.id,
        maxPaths: 5,
        maxHops: 12,
        highlight: false,
      }),
    ).toEqual({ ok: true, paths: [], unknown: ["page:missing"] });
  });
});

describe("graph_view screenshot", () => {
  it("queues the image on the host channel and reports its size", async () => {
    const { access, state } = harness({ ok: true, view, layout });
    const result = await access.capture({});
    expect(result).toEqual({ captured: true, width: 320, height: 200, bytes: 3 });
    expect(state.scenes).toHaveLength(1);
    expect(access.takeImages()).toEqual(["data:image/jpeg;base64,QUJD"]);
    expect(access.takeImages()).toEqual([]);
  });

  it("renders only the requested subset", async () => {
    const { access, state } = harness({ ok: true, view, layout });
    await access.capture({ nodes: [PAGE.id] });
    expect(state.scenes[0]?.nodes.map((node) => node.id)).toEqual([PAGE.id]);
    expect(state.scenes[0]?.edges).toEqual([]);
    await access.capture({ edges: [ROUTE_TABLE.id] });
    expect(state.scenes[1]?.nodes.map((node) => node.id)).toEqual([GET.id, TODOS.id]);
    expect(state.scenes[1]?.edges.map((edge) => edge.id)).toEqual([ROUTE_TABLE.id]);
  });

  it("caps the images per program", async () => {
    const { access } = harness({ ok: true, view, layout });
    expect(await access.capture({})).toMatchObject({ captured: true });
    expect(await access.capture({})).toMatchObject({ captured: true });
    expect(await access.capture({})).toEqual({ captured: false, reason: "image_limit" });
    expect(access.takeImages()).toHaveLength(2);
  });

  it("reasons in machine codes", async () => {
    const closed = harness({ ok: false, reason: "no_project" });
    expect(await closed.access.capture({})).toEqual({
      captured: false,
      reason: "no_project",
    });
    const broken = harness({ ok: false, reason: "analysis_failed" });
    expect(await broken.access.capture({})).toEqual({
      captured: false,
      reason: "analysis_failed",
    });
    const empty = harness(EMPTY_LOAD);
    expect(await empty.access.capture({})).toEqual({
      captured: false,
      reason: "empty_graph",
    });
    const unknown = harness({ ok: true, view, layout });
    expect(await unknown.access.capture({ nodes: ["table:missing"] })).toEqual({
      captured: false,
      reason: "unknown_ids",
    });
    const unrenderable = harness({ ok: true, view, layout }, { render: () => null });
    expect(await unrenderable.access.capture({})).toEqual({
      captured: false,
      reason: "render_failed",
    });
  });

  it("turns a throwing canvas into a reason, not an exception", async () => {
    const { access } = harness(
      { ok: true, view, layout },
      {
        render: () => {
          throw new Error("no canvas");
        },
      },
    );
    expect(await access.capture({})).toEqual({ captured: false, reason: "render_failed" });
  });
});
