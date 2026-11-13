import { describe, expect, it } from "vitest";
import {
  GRAPH_BENDS_DIR,
  GRAPH_LAYOUT_PATH,
  GRAPH_LAYOUT_VERSION,
  GRAPH_NOTES_DIR,
  GRAPH_POSITIONS_DIR,
  GRAPH_VIEWPORT_PATH,
  emptyGraphLayout,
  type GraphLayoutFile,
} from "./graph-layout-file";
import {
  bendPath,
  decodeGraphLayout,
  elementFileName,
  elementPath,
  encodeGraphLayout,
  noteFilePath,
  noteIdFromFileName,
} from "./graph-layout-files";

const UUID = "11111111-1111-4111-8111-111111111111";
const NOTE = "note:" + UUID;
const note = { id: NOTE, x: 30, y: 40, text: "# Annotazione\n\n- uno\n" };

const layout = (overrides: Partial<GraphLayoutFile> = {}): GraphLayoutFile => ({
  ...emptyGraphLayout(),
  ...overrides,
});

function filesOf(value: GraphLayoutFile): Map<string, string> {
  return new Map(encodeGraphLayout(value).map((write) => [write.path, write.contents] as const));
}

const position = (id: string, x: number, y: number) => JSON.stringify({ id, x, y }) + "\n";

describe("decodeGraphLayout", () => {
  it("reads settings, per-element positions, bends, notes and the local viewport", () => {
    const decoded = decodeGraphLayout({
      layout: JSON.stringify({
        version: 3,
        hiddenEdges: ["relation"],
        collapsed: { "table:todos": true },
      }),
      viewport: JSON.stringify({ x: 5, y: 6, zoom: 0.5 }),
      positions: {
        "a.json": position("table:todos", 10, 20),
        "b.json": position(NOTE, 30, 40),
      },
      bends: { "c.json": position("fk:1", 2, -3) },
      notes: { [NOTE]: note.text },
    });
    expect(decoded.source).toBe("ok");
    expect(decoded.layout).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      nodes: { "table:todos": { x: 10, y: 20 } },
      hiddenEdges: ["relation"],
      tableVisibility: "all",
      collapsed: { "table:todos": true },
      edgeCurves: { "fk:1": { x: 2, y: -3 } },
      notes: { [NOTE]: note },
      viewport: { x: 5, y: 6, zoom: 0.5 },
    });
  });

  it("returns the missing state when nothing exists", () => {
    const empty = { layout: emptyGraphLayout(), source: "missing" as const };
    expect(decodeGraphLayout({})).toEqual(empty);
    expect(decodeGraphLayout({ layout: "  ", positions: {}, bends: {}, notes: {} })).toEqual(empty);
  });

  it("migrates the legacy single file only while the v3 files are absent", () => {
    const legacy = JSON.stringify({
      version: 2,
      nodes: { "table:todos": { x: 1, y: 2 } },
      edgeCurves: { "fk:1": { x: 3, y: 4 } },
    });
    const migrated = decodeGraphLayout({ legacy });
    expect(migrated.source).toBe("ok");
    expect(migrated.layout.nodes).toEqual({ "table:todos": { x: 1, y: 2 } });
    expect(migrated.layout.edgeCurves).toEqual({ "fk:1": { x: 3, y: 4 } });
    expect(migrated.layout.tableVisibility).toBe("all");
    const current = decodeGraphLayout({
      legacy,
      positions: { "a.json": position("table:todos", 9, 9) },
    });
    expect(current.layout.nodes).toEqual({ "table:todos": { x: 9, y: 9 } });
    expect(current.layout.edgeCurves).toEqual({});
    expect(decodeGraphLayout({ legacy: "{" }).source).toBe("invalid");
  });

  it("reports a corrupt or unknown settings file as invalid", () => {
    expect(
      decodeGraphLayout({ layout: "{", positions: { "a.json": position("a", 1, 2) } }).source,
    ).toBe("invalid");
    expect(decodeGraphLayout({ layout: JSON.stringify({ version: 2 }) }).source).toBe("invalid");
    expect(decodeGraphLayout({ layout: JSON.stringify({ version: 3 }) }).source).toBe("ok");
  });

  it("migrates the old hide flags: hideSystemTables true reads as used", () => {
    expect(
      decodeGraphLayout({ layout: JSON.stringify({ version: 3 }) }).layout.tableVisibility,
    ).toBe("all");
    expect(
      decodeGraphLayout({ layout: JSON.stringify({ version: 3, hideSystemTables: false }) }).layout
        .tableVisibility,
    ).toBe("all");
    // The old routes flag has no meaning any more: every route is project code.
    expect(
      decodeGraphLayout({
        layout: JSON.stringify({ version: 3, hideSystemTables: true, hideSystemRoutes: true }),
      }).layout.tableVisibility,
    ).toBe("used");
    expect(
      decodeGraphLayout({ layout: JSON.stringify({ version: 3, tableVisibility: "project" }) })
        .layout.tableVisibility,
    ).toBe("project");
    expect(
      decodeGraphLayout({ layout: JSON.stringify({ version: 3, tableVisibility: "sideways" }) })
        .layout.tableVisibility,
    ).toBe("all");
  });

  it("skips one corrupt element file instead of losing the rest", () => {
    const decoded = decodeGraphLayout({
      positions: {
        "a.json": position("a", 1, 2),
        "b.json": "not json",
        "c.json": '{"id":"c","x":"3","y":4}',
        "d.json": position("d", 5, 6),
      },
    });
    expect(decoded.source).toBe("ok");
    expect(decoded.layout.nodes).toEqual({ a: { x: 1, y: 2 }, d: { x: 5, y: 6 } });
  });

  it("parks a note without a saved position instead of dropping it", () => {
    const decoded = decodeGraphLayout({ notes: { [NOTE]: "hi\n" } });
    expect(decoded.layout.notes[NOTE]).toEqual({ id: NOTE, x: 40, y: 40, text: "hi\n" });
  });

  it("ignores note files whose name is not one of ours", () => {
    const decoded = decodeGraphLayout({
      notes: { "note:not-a-uuid": "hi\n", "note:../evil": "x", "readme.md": "y" },
    });
    expect(decoded.layout.notes).toEqual({});
  });
});

describe("encodeGraphLayout", () => {
  it("writes one small file per element, the settings and the local viewport", () => {
    const files = filesOf(
      layout({
        nodes: { "table:todos": { x: 7, y: 8 } },
        edgeCurves: { "fk:1": { x: 1, y: 2 } },
        hiddenEdges: ["relation", "fk"],
        tableVisibility: "used",
        collapsed: { "table:todos": true },
        notes: { [NOTE]: note },
        viewport: { x: 1, y: 2, zoom: 0.5 },
      }),
    );
    expect(JSON.parse(files.get(GRAPH_LAYOUT_PATH) ?? "")).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      hiddenEdges: ["fk", "relation"],
      tableVisibility: "used",
      collapsed: { "table:todos": true },
    });
    expect(files.get(GRAPH_POSITIONS_DIR + "/table%3Atodos.json")).toBe(
      position("table:todos", 7, 8),
    );
    expect(files.get(elementPath(NOTE))).toBe(position(NOTE, 30, 40));
    expect(files.get(GRAPH_BENDS_DIR + "/fk%3A1.json")).toBe(position("fk:1", 1, 2));
    expect(files.get(GRAPH_NOTES_DIR + "/" + UUID + ".md")).toBe(note.text);
    expect(JSON.parse(files.get(GRAPH_VIEWPORT_PATH) ?? "")).toEqual({ x: 1, y: 2, zoom: 0.5 });
  });

  it("serialises the view edge kinds in the canonical appended order", () => {
    const files = filesOf(layout({ hiddenEdges: ["view-base", "route-view"] }));
    expect(JSON.parse(files.get(GRAPH_LAYOUT_PATH) ?? "")).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      hiddenEdges: ["route-view", "view-base"],
      tableVisibility: "all",
      collapsed: {},
    });
  });

  it("rounds positions to two decimals", () => {
    const files = filesOf(
      layout({ nodes: { a: { x: 1.234, y: -1.5 } }, edgeCurves: { b: { x: 0.555, y: -1 } } }),
    );
    expect(files.get(GRAPH_POSITIONS_DIR + "/a.json")).toBe(position("a", 1.23, -1.5));
    expect(files.get(GRAPH_BENDS_DIR + "/b.json")).toBe(position("b", 0.56, -1));
  });

  it("writes empty settings for an empty layout and normalises note markdown", () => {
    const files = filesOf(emptyGraphLayout());
    expect(JSON.parse(files.get(GRAPH_LAYOUT_PATH) ?? "")).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      hiddenEdges: [],
      tableVisibility: "all",
      collapsed: {},
    });
    expect(files.get(GRAPH_VIEWPORT_PATH)).toBe("");
    const notes = filesOf(layout({ notes: { [NOTE]: { ...note, text: "hi\n\n\n" } } }));
    expect(notes.get(noteFilePath(NOTE) ?? "")).toBe("hi\n");
    const empty = filesOf(layout({ notes: { [NOTE]: { ...note, text: "" } } }));
    expect(empty.get(noteFilePath(NOTE) ?? "")).toBe("");
  });

  it("round-trips a layout through the files", () => {
    const value = layout({
      nodes: { "table:todos": { x: 7, y: 8 } },
      edgeCurves: { "fk:1": { x: 2, y: -3 } },
      hiddenEdges: ["fk"],
      tableVisibility: "used",
      collapsed: { "table:todos": true },
      notes: { [NOTE]: note },
      viewport: { x: 1, y: 2, zoom: 1 },
    });
    const files = filesOf(value);
    const decoded = decodeGraphLayout({
      layout: files.get(GRAPH_LAYOUT_PATH),
      viewport: files.get(GRAPH_VIEWPORT_PATH),
      positions: {
        [elementFileName("table:todos")]: files.get(elementPath("table:todos")) ?? "",
        [elementFileName(NOTE)]: files.get(elementPath(NOTE)) ?? "",
      },
      bends: { [elementFileName("fk:1")]: files.get(bendPath("fk:1")) ?? "" },
      notes: { [NOTE]: files.get(noteFilePath(NOTE) ?? "") ?? "" },
    });
    expect(decoded.source).toBe("ok");
    expect(decoded.layout).toEqual(value);
  });
});

describe("element and note file names", () => {
  it("encodes ids into filesystem-safe, readable names", () => {
    expect(elementFileName("table:todos")).toBe("table%3Atodos.json");
    expect(elementFileName("route:GET /api/todos/{id}")).toBe(
      "route%3AGET%20%2Fapi%2Ftodos%2F%7Bid%7D.json",
    );
    expect(elementPath("page:src/pages/index.tsx")).toBe(
      GRAPH_POSITIONS_DIR + "/page%3Asrc%2Fpages%2Findex.tsx.json",
    );
  });

  it("falls back to a short stable hash for very long ids", () => {
    const long = "page:" + "a".repeat(400);
    const name = elementFileName(long);
    expect(name.startsWith("~")).toBe(true);
    expect(name.endsWith(".json")).toBe(true);
    expect(name.length).toBeLessThan(30);
    expect(elementFileName(long)).toBe(name);
    expect(elementFileName(long + "x")).not.toBe(name);
  });

  it("maps note ids to uuid markdown files and back", () => {
    expect(noteFilePath(NOTE)).toBe(GRAPH_NOTES_DIR + "/" + UUID + ".md");
    expect(noteIdFromFileName(UUID + ".md")).toBe(NOTE);
    expect(noteFilePath("table:todos")).toBeNull();
    expect(noteFilePath("note:not-a-uuid")).toBeNull();
    expect(noteIdFromFileName("readme.md")).toBeNull();
    expect(noteIdFromFileName(UUID + ".txt")).toBeNull();
  });
});
