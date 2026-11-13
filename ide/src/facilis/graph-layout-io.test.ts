import { describe, expect, it } from "vitest";
import type { IdeController } from "@/vv/controller";
import {
  GRAPH_BENDS_DIR,
  GRAPH_LAYOUT_PATH,
  GRAPH_LEGACY_PATH,
  GRAPH_NOTES_DIR,
  GRAPH_POSITIONS_DIR,
  GRAPH_VIEWPORT_PATH,
  emptyGraphLayout,
  type GraphLayoutFile,
} from "./graph-layout-file";
import { elementPath, noteFilePath } from "./graph-layout-files";
import { loadGraphLayout, saveGraphLayout } from "./graph-layout";
import type { GraphNote } from "./graph-types";

const ROOT = "/w/app";
const UUID = "11111111-1111-4111-8111-111111111111";
const NOTE = "note:" + UUID;
const IGNORE = ROOT + "/.facilis/.gitignore";
const note: GraphNote = { id: NOTE, x: 30, y: 40, text: "# Nota\n" };

const layout = (overrides: Partial<GraphLayoutFile> = {}): GraphLayoutFile => ({
  ...emptyGraphLayout(),
  ...overrides,
});

function fakeController(files: Record<string, string>) {
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
      if (name === "") continue;
      names.set(name, (names.get(name) ?? false) || slash !== -1);
    }
    return [...names].map(([name, nested]) => ({ name, dir: nested }));
  };
  const controller = {
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
  };
  return { controller: controller as unknown as IdeController, writes, files, removed };
}

const position = (id: string, x: number, y: number) => JSON.stringify({ id, x, y }) + "\n";

describe("loadGraphLayout", () => {
  it("reads the per-element files, the notes and the local viewport", async () => {
    const { controller } = fakeController({
      [ROOT + "/" + GRAPH_LAYOUT_PATH]: JSON.stringify({
        version: 3,
        hiddenEdges: ["relation"],
        collapsed: { "table:todos": true },
      }),
      [ROOT + "/" + GRAPH_POSITIONS_DIR + "/a.json"]: position("table:todos", 10, 20),
      [ROOT + "/" + GRAPH_POSITIONS_DIR + "/b.json"]: position(NOTE, 30, 40),
      [ROOT + "/" + GRAPH_BENDS_DIR + "/c.json"]: position("fk:1", 2, -3),
      [ROOT + "/" + GRAPH_VIEWPORT_PATH]: JSON.stringify({ x: 5, y: 6, zoom: 0.5 }),
      [ROOT + "/" + GRAPH_NOTES_DIR + "/" + UUID + ".md"]: "# Nota\n",
    });
    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.source).toBe("ok");
    expect(loaded.layout.nodes).toEqual({ "table:todos": { x: 10, y: 20 } });
    expect(loaded.layout.hiddenEdges).toEqual(["relation"]);
    expect(loaded.layout.collapsed).toEqual({ "table:todos": true });
    expect(loaded.layout.edgeCurves).toEqual({ "fk:1": { x: 2, y: -3 } });
    expect(loaded.layout.viewport).toEqual({ x: 5, y: 6, zoom: 0.5 });
    expect(loaded.layout.notes).toEqual({ [NOTE]: note });
    expect(loaded.layout.tableVisibility).toBe("all");
  });

  it("migrates the legacy single file while the v3 directory is absent", async () => {
    const { controller } = fakeController({
      [ROOT + "/" + GRAPH_LEGACY_PATH]: JSON.stringify({
        version: 2,
        nodes: { "table:todos": { x: 1, y: 2 } },
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    });
    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.source).toBe("ok");
    expect(loaded.layout.nodes).toEqual({ "table:todos": { x: 1, y: 2 } });
    expect(loaded.layout.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("treats an absent state as missing and reports a corrupt settings file", async () => {
    expect((await loadGraphLayout(fakeController({}).controller, ROOT)).source).toBe("missing");
    const corrupt = fakeController({ [ROOT + "/" + GRAPH_LAYOUT_PATH]: "{" });
    expect((await loadGraphLayout(corrupt.controller, ROOT)).source).toBe("invalid");
  });
});

describe("saveGraphLayout", () => {
  it("round-trips the table visibility through the saved files", async () => {
    const { controller } = fakeController({});
    await saveGraphLayout(controller, ROOT, layout({ tableVisibility: "project" }));
    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.source).toBe("ok");
    expect(loaded.layout.tableVisibility).toBe("project");
  });

  it("writes the state files and the gitignore allowlist on a first save", async () => {
    const { controller, writes, files, removed } = fakeController({});
    const value = layout({
      nodes: { "table:todos": { x: 7, y: 8 } },
      edgeCurves: { "fk:1": { x: 1, y: 2 } },
      notes: { [NOTE]: note },
      viewport: { x: 1, y: 2, zoom: 1 },
    });
    await saveGraphLayout(controller, ROOT, value);
    const written = new Map(
      writes
        .filter((write) => write.type === "vv-write")
        .map((write) => [write.path, write.contents] as const),
    );
    expect(written.get(ROOT + "/" + elementPath("table:todos"))).toBe(
      position("table:todos", 7, 8),
    );
    expect(written.get(ROOT + "/" + elementPath(NOTE))).toBe(position(NOTE, 30, 40));
    expect(written.get(ROOT + "/" + noteFilePath(NOTE))).toBe("# Nota\n");
    expect(JSON.parse(written.get(ROOT + "/" + GRAPH_LAYOUT_PATH) ?? "")).toMatchObject({
      version: 3,
    });
    expect(written.get(ROOT + "/" + GRAPH_VIEWPORT_PATH)).toContain('"zoom":1');
    expect(written.get(IGNORE)).toContain("!graph/\n!graph/**\ngraph/viewport.json");
    expect(removed).toEqual([]);
    expect(files[IGNORE]).toBeDefined();
  });

  it("writes only the element that changed when the previous layout is given", async () => {
    const { controller, writes } = fakeController({});
    const before = layout({ nodes: { a: { x: 1, y: 1 } } });
    const after = layout({ nodes: { a: { x: 2, y: 2 } } });
    await saveGraphLayout(controller, ROOT, before);
    writes.length = 0;
    await saveGraphLayout(controller, ROOT, after, before);
    expect(writes.filter((write) => write.type === "vv-write").map((write) => write.path)).toEqual([
      ROOT + "/" + elementPath("a"),
    ]);
  });

  it("removes the files of an element the next layout dropped", async () => {
    const { controller, writes, removed } = fakeController({});
    const before = layout({ nodes: { a: { x: 1, y: 1 } }, notes: { [NOTE]: note } });
    await saveGraphLayout(controller, ROOT, before);
    writes.length = 0;
    await saveGraphLayout(controller, ROOT, emptyGraphLayout(), before);
    expect(removed).toEqual(
      expect.arrayContaining([
        ROOT + "/" + elementPath("a"),
        ROOT + "/" + elementPath(NOTE),
        ROOT + "/" + noteFilePath(NOTE),
      ]),
    );
  });

  it("appends the allowlist once to an existing .facilis/.gitignore", async () => {
    const { controller, files } = fakeController({ [IGNORE]: "*\n" });
    const value = layout({ nodes: { a: { x: 1, y: 2 } } });
    await saveGraphLayout(controller, ROOT, value);
    const afterFirst = files[IGNORE];
    expect(afterFirst?.startsWith("*\n")).toBe(true);
    expect(afterFirst?.match(/^!graph\/$/gm)).toHaveLength(1);
    await saveGraphLayout(controller, ROOT, value);
    expect(files[IGNORE]).toBe(afterFirst);
  });

  it("removes the obsolete single-file layout after a successful save", async () => {
    const { controller, removed } = fakeController({
      [ROOT + "/" + GRAPH_LEGACY_PATH]: JSON.stringify({ version: 1 }),
      [ROOT + "/.facilis/graph/nodes.jsonl"]: '{"id":"a","x":1,"y":1}\n',
    });
    await saveGraphLayout(controller, ROOT, emptyGraphLayout());
    expect(removed).toEqual(
      expect.arrayContaining([
        ROOT + "/" + GRAPH_LEGACY_PATH,
        ROOT + "/.facilis/graph/nodes.jsonl",
      ]),
    );
  });
});
