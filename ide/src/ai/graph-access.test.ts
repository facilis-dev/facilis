import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis, GraphNode } from "@facilis.dev/analyze";
import { GRAPH_NOTES_DIR } from "@/facilis/graph-layout-file";
import { bendPath, elementPath, noteFilePath } from "@/facilis/graph-layout-files";
import { ACTIVE_TODOS, GET, PAGE, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import { subscribeGraphLayoutChanged } from "@/facilis/graph-live";
import { createGraphAccess } from "./graph-access";
import {
  analysisOf,
  fakeController,
  GRAPH,
  NOTE,
  OLD_NOTE,
  refusalOf,
  ROOT,
  seedLayout,
  stateOf,
  uuidOf,
} from "./graph-access.test-fixtures";

const analysisState = vi.hoisted(() => ({ current: null as Analysis | null, error: "" }));

vi.mock("@/facilis/analyze-client", () => ({
  loadProjectAnalysis: async () =>
    analysisState.current === null
      ? { ok: false, error: analysisState.error }
      : { ok: true, analysis: analysisState.current },
}));

beforeEach(() => {
  analysisState.current = analysisOf(GRAPH);
  analysisState.error = "";
});

describe("graph_state", () => {
  it("reports positions, edges, notes and the view settings", async () => {
    const files = seedLayout(
      { hiddenEdges: ["relation"], collapsed: { [TODOS.id]: true } },
      ['{"id":"' + GET.id + '","x":10,"y":20}'],
      { [NOTE]: "# Nota" },
    );
    const view = await stateOf(createGraphAccess(fakeController(files).controller));
    expect(view.available).toBe(true);
    expect(view.root).toBe(ROOT);
    expect(view.counts).toEqual({ nodes: 3, edges: 2, notes: 1 });
    expect(view.hidden_edges).toEqual(["relation"]);
    expect(view.collapsed).toEqual([TODOS.id]);
    expect(view.nodes?.find((node) => node.id === GET.id)).toEqual({
      id: GET.id,
      kind: "route",
      label: GET.label,
      x: 10,
      y: 20,
    });
    // A node with no saved position reports its deterministic automatic position.
    const page = view.nodes?.find((node) => node.id === PAGE.id);
    expect(Number.isFinite(page?.x)).toBe(true);
    expect(Number.isFinite(page?.y)).toBe(true);
    expect(view.edges?.find((edge) => edge.id === "page-route:1")).toMatchObject({
      kind: "page-route",
    });
    expect(view.notes?.[0]).toMatchObject({ id: NOTE, text: "# Nota" });
    expect(Number.isFinite(view.notes?.[0]?.x)).toBe(true);
    expect(Number.isFinite(view.notes?.[0]?.y)).toBe(true);
  });

  it("reports view nodes, their kind and the view edges", async () => {
    analysisState.current = analysisOf(
      graphOf(
        [GET, TODOS, ACTIVE_TODOS],
        [
          {
            id: "route-view:1",
            kind: "route-view",
            source: GET.id,
            target: ACTIVE_TODOS.id,
            label: "dbTables",
          },
          {
            id: "view-base:1",
            kind: "view-base",
            source: ACTIVE_TODOS.id,
            target: TODOS.id,
            label: null,
          },
        ],
      ),
    );
    const view = await stateOf(createGraphAccess(fakeController(seedLayout({})).controller));
    expect(view.nodes?.find((node) => node.id === ACTIVE_TODOS.id)).toMatchObject({
      kind: "view",
      label: "active_todos",
    });
    expect(view.edges?.find((edge) => edge.id === "route-view:1")).toMatchObject({
      kind: "route-view",
    });
    expect(view.edges?.find((edge) => edge.id === "view-base:1")).toMatchObject({
      kind: "view-base",
    });
  });

  it("caps nodes, edges and notes and flags the truncation", async () => {
    const pages = Array.from({ length: 201 }, (_, index): GraphNode => ({
      ...PAGE,
      id: "page:p" + index,
      label: "P" + index,
    }));
    const edges = Array.from({ length: 601 }, (_, index) => ({
      id: "e" + index,
      kind: "fk" as const,
      source: "page:p0",
      target: "page:p1",
      label: null,
    }));
    analysisState.current = analysisOf(graphOf(pages, edges));
    const longText = "x".repeat(2_500);
    const notes = Object.fromEntries(
      Array.from({ length: 41 }, (_, index) => ["note:" + uuidOf(index), longText]),
    );
    const view = await stateOf(
      createGraphAccess(fakeController(seedLayout({}, [], notes)).controller),
    );
    expect(view.nodes).toHaveLength(200);
    expect(view.nodes_truncated).toBe(true);
    expect(view.edges).toHaveLength(600);
    expect(view.edges_truncated).toBe(true);
    expect(view.notes).toHaveLength(40);
    expect(view.notes_truncated).toBe(true);
    expect(view.notes?.[0]?.text).toHaveLength(2_000);
  });

  it("returns an analysis failure as data and no project as unavailable", async () => {
    analysisState.current = null;
    analysisState.error = "worker failed";
    const failed = await stateOf(createGraphAccess(fakeController({}).controller));
    expect(failed).toMatchObject({ available: true, error: "worker failed" });
    const closed = await stateOf(createGraphAccess(fakeController({}, null).controller));
    expect(closed.available).toBe(false);
  });
});

describe("graph_arrange", () => {
  it("writes moves, curves, notes, deletes, hidden kinds and collapse, then notifies", async () => {
    let notified = 0;
    const unsubscribe = subscribeGraphLayoutChanged(() => {
      notified += 1;
    });
    const { controller, files, removed } = fakeController(
      seedLayout({}, [], { [NOTE]: "old", [OLD_NOTE]: "delete me" }),
    );
    const access = createGraphAccess(controller);
    const result = await access.apply({
      moves: [{ id: GET.id, x: 100, y: 200 }],
      curves: [{ edgeId: "page-route:1", x: 5, y: -6 }],
      notes: [
        { id: NOTE, x: 1, y: 2, text: "edited" },
        { x: 3, y: 4, text: "created" },
      ],
      delete_notes: [OLD_NOTE],
      hidden_edges: ["page-route"],
      collapsed: [{ id: TODOS.id, collapsed: true }],
    });
    unsubscribe();
    expect(result).toEqual({
      ok: true,
      applied: {
        moves: 1,
        curves: 1,
        created: 1,
        edited: 1,
        deleted: 1,
        hiddenEdges: 1,
        collapsed: 1,
      },
    });
    expect(notified).toBe(1);
    const moved = files[ROOT + "/" + elementPath(GET.id)] ?? "";
    expect(moved).toContain('{"id":"' + GET.id + '","x":100,"y":200}');
    expect(files[ROOT + "/" + bendPath("page-route:1")] ?? "").toContain(
      '{"id":"page-route:1","x":5,"y":-6}',
    );
    expect(JSON.parse(files[ROOT + "/.facilis/graph/layout.json"] ?? "")).toEqual({
      version: 3,
      hiddenEdges: ["page-route"],
      hideSystemRoutes: false,
      hideSystemTables: false,
      collapsed: { [TODOS.id]: true },
    });
    expect(files[ROOT + "/" + noteFilePath(NOTE)]?.trim()).toBe("edited");
    const createdFile = Object.keys(files).find((path) => files[path]?.trim() === "created");
    expect(createdFile?.startsWith(ROOT + "/" + GRAPH_NOTES_DIR + "/")).toBe(true);
    expect(removed).toContain(ROOT + "/" + noteFilePath(OLD_NOTE));
  });

  it("accepts the view edge kinds in the hidden set, in canonical order", async () => {
    const { controller, files } = fakeController(seedLayout({}));
    const access = createGraphAccess(controller);
    const result = await access.apply({ hidden_edges: ["view-base", "route-view"] });
    expect(result).toMatchObject({ ok: true, applied: { hiddenEdges: 2 } });
    expect(JSON.parse(files[ROOT + "/.facilis/graph/layout.json"] ?? "")).toEqual({
      version: 3,
      hiddenEdges: ["route-view", "view-base"],
      hideSystemRoutes: false,
      hideSystemTables: false,
      collapsed: {},
    });
  });

  it("refuses unknown ids and non-finite coordinates", async () => {
    const { controller, writes } = fakeController({});
    const access = createGraphAccess(controller);
    const unknownNode = await refusalOf(
      access.apply({ moves: [{ id: "table:nope", x: 1, y: 2 }] }),
    );
    expect(unknownNode.message).toContain("not in the current graph");
    const unknownEdge = await refusalOf(
      access.apply({ curves: [{ edgeId: "edge:nope", x: 1, y: 2 }] }),
    );
    expect(unknownEdge.message).toContain("curves[0].edgeId");
    const unknownNote = await refusalOf(
      access.apply({ notes: [{ id: "note:nope", x: 1, y: 2, text: "x" }] }),
    );
    expect(unknownNote.message).toContain("notes[0].id");
    const notFinite = await refusalOf(
      access.apply({ moves: [{ id: GET.id, x: Number.NaN, y: 2 }] }),
    );
    expect(notFinite.message).toContain("finite");
    expect(writes.filter((write) => write.type === "vv-write")).toHaveLength(0);
  });

  it("refuses oversized plans, bad fields and edits that also delete", async () => {
    const { controller } = fakeController(seedLayout({}, [], { [NOTE]: "old" }));
    const access = createGraphAccess(controller);
    const moves = Array.from({ length: 501 }, () => ({ id: GET.id, x: 1, y: 2 }));
    const oversized = await refusalOf(access.apply({ moves }));
    expect(oversized.message).toContain("at most 500");
    const badField = await refusalOf(access.apply({ rotate: true }));
    expect(badField.message).toContain("unknown field");
    const conflict = await refusalOf(
      access.apply({ notes: [{ id: NOTE, x: 1, y: 2, text: "new" }], delete_notes: [NOTE] }),
    );
    expect(conflict.message).toContain("both edit and delete");
    const noProject = await createGraphAccess(fakeController({}, null).controller).apply({});
    expect(noProject).toMatchObject({ available: false });
  });
});
