import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Analysis, GraphNode, ProjectGraph } from "@facilis/analyze";
import type { IdeController } from "@/vv/controller";
import { GRAPH_LAYOUT_PATH, GRAPH_NOTES_DIR } from "@/facilis/graph-layout-file";
import { bendPath, elementPath, noteFilePath } from "@/facilis/graph-layout-files";
import { graphOf, GET, PAGE, TODOS } from "@/facilis/graph-model.test-fixtures";
import { subscribeGraphLayoutChanged } from "@/facilis/graph-live";
import { analyzeSources } from "./analysis-fixtures";
import { createGraphAccess, type GraphAccess } from "./graph-access";
import { isPtcToolError } from "./ptc/protocol";

const analysisState = vi.hoisted(() => ({ current: null as Analysis | null, error: "" }));

vi.mock("@/facilis/analyze-client", () => ({
  loadProjectAnalysis: async () =>
    analysisState.current === null
      ? { ok: false, error: analysisState.error }
      : { ok: true, analysis: analysisState.current },
}));

const ROOT = "/w/app";
const NOTE = "note:11111111-1111-4111-8111-111111111111";
const OLD_NOTE = "note:22222222-2222-4222-8222-222222222222";
const empty = analyzeSources(new Map());
const analysisOf = (graph: ProjectGraph): Analysis => ({ ...empty, graph });

const GRAPH = graphOf(
  [PAGE, GET, TODOS],
  [
    { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
    { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
  ],
);

function uuidOf(index: number): string {
  return String(index).padStart(8, "0") + "-0000-4000-8000-000000000000";
}

function fakeController(files: Record<string, string>, root: string | null = ROOT) {
  const writes: { type: string; path: string; contents?: string }[] = [];
  const removed: string[] = [];
  const children = (dir: string): { name: string; dir: boolean }[] => {
    const prefix = dir + "/";
    const names = new Map<string, boolean>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (name !== "") names.set(name, (names.get(name) ?? false) || slash !== -1);
    }
    return [...names].map(([name, nested]) => ({ name, dir: nested }));
  };
  return {
    controller: {
      activeFolder: root === null ? null : { rootPath: root },
      readFileText: async (path: string) => files[path] ?? "",
      readdir: async (dir: string) => children(dir),
      pathInfo: async (path: string) => ({
        exists: path in files || Object.keys(files).some((entry) => entry.startsWith(path + "/")),
        isDir: false,
      }),
      bridge: {
        request: async (type: string, extra?: Record<string, unknown>) => {
          const path = String(extra?.path ?? "");
          const contents = typeof extra?.contents === "string" ? extra.contents : undefined;
          writes.push({ type, path, contents });
          if (type === "vv-write") files[path] = contents ?? "";
          if (type === "vv-rm") {
            delete files[path];
            removed.push(path);
          }
          return { type: "vv-reply", ok: true };
        },
      },
    } as unknown as IdeController,
    files,
    writes,
    removed,
  };
}

/** Seed the v3 layout files: settings plus node positions and note bodies. */
function seedLayout(
  layout: Record<string, unknown>,
  positions: readonly string[] = [],
  notes: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const files: Record<string, string> = {
    [ROOT + "/" + GRAPH_LAYOUT_PATH]: JSON.stringify({ version: 3, ...layout }),
  };
  // One position file per element (D-126), keyed exactly like the real encoder.
  for (const line of positions) {
    const entry = JSON.parse(line) as { id: string };
    files[ROOT + "/" + elementPath(entry.id)] = line + "\n";
  }
  for (const [id, text] of Object.entries(notes)) {
    files[ROOT + "/" + GRAPH_NOTES_DIR + "/" + id.slice(5) + ".md"] = text;
  }
  return files;
}

interface StateView {
  available: boolean;
  root?: string;
  source?: string;
  error?: string;
  counts?: { nodes: number; edges: number; notes: number };
  nodes?: { id: string; kind: string; label: string; x: number; y: number }[];
  nodes_truncated?: boolean;
  edges?: { id: string; kind: string; curve?: { x: number; y: number } }[];
  edges_truncated?: boolean;
  notes?: { id: string; x: number; y: number; text: string }[];
  notes_truncated?: boolean;
  hidden_edges?: string[];
  collapsed?: string[];
}

async function stateOf(access: GraphAccess): Promise<StateView> {
  return (await access.state()) as unknown as StateView;
}

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (isPtcToolError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to be refused");
}

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
      collapsed: { [TODOS.id]: true },
    });
    expect(files[ROOT + "/" + noteFilePath(NOTE)]?.trim()).toBe("edited");
    const createdFile = Object.keys(files).find((path) => files[path]?.trim() === "created");
    expect(createdFile?.startsWith(ROOT + "/" + GRAPH_NOTES_DIR + "/")).toBe(true);
    expect(removed).toContain(ROOT + "/" + noteFilePath(OLD_NOTE));
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
