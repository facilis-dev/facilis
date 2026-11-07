import { describe, expect, it } from "vitest";
import type { IdeController } from "@/vv/controller";
import {
  GRAPH_EDGE_KINDS,
  GRAPH_LAYOUT_VERSION,
  emptyGraphLayout,
  graphLayoutPath,
  loadGraphLayout,
  mergeGraphLayout,
  parseGraphLayout,
  resetGraphLayoutPositions,
  saveGraphLayout,
  serializeGraphLayout,
  withCollapsed,
  withHiddenEdgeKind,
  withNodePosition,
  withViewport,
  type GraphLayoutFile,
} from "./graph-layout";

const layout = (overrides: Partial<GraphLayoutFile> = {}): GraphLayoutFile => ({
  ...emptyGraphLayout(),
  ...overrides,
});

function serialized(value: GraphLayoutFile): unknown {
  return JSON.parse(serializeGraphLayout(value));
}

describe("parseGraphLayout", () => {
  it("reads every field of a version-1 file", () => {
    const parsed = parseGraphLayout(
      JSON.stringify({
        version: 1,
        nodes: { "table:todos": { x: 10, y: 20 } },
        hiddenEdges: ["relation", "fk"],
        collapsed: { "table:todos": true },
        viewport: { x: 1, y: 2, zoom: 0.8 },
      }),
    );
    expect(parsed.source).toBe("ok");
    expect(parsed.layout).toEqual({
      version: 1,
      nodes: { "table:todos": { x: 10, y: 20 } },
      hiddenEdges: ["fk", "relation"],
      collapsed: { "table:todos": true },
      viewport: { x: 1, y: 2, zoom: 0.8 },
    });
  });

  it("treats a missing or blank file as no saved layout", () => {
    for (const text of ["", "   ", null, undefined]) {
      const parsed = parseGraphLayout(text);
      expect(parsed.source).toBe("missing");
      expect(parsed.layout).toEqual(emptyGraphLayout());
    }
  });

  it("reports corrupt JSON and an unknown version as invalid", () => {
    expect(parseGraphLayout("{").source).toBe("invalid");
    expect(parseGraphLayout("[]").source).toBe("invalid");
    expect(parseGraphLayout(JSON.stringify({ version: 2, nodes: {} })).source).toBe("invalid");
    expect(parseGraphLayout(JSON.stringify({ nodes: {} })).source).toBe("invalid");
    const invalid = parseGraphLayout("{");
    expect(invalid.layout).toEqual(emptyGraphLayout());
  });

  it("ignores malformed entries instead of throwing", () => {
    const parsed = parseGraphLayout(
      JSON.stringify({
        version: 1,
        nodes: {
          good: { x: 1, y: 2 },
          bad: { x: "1", y: 2 },
          missing: { x: 1 },
        },
        hiddenEdges: ["fk", "not-a-kind", 3],
        collapsed: { good: true, bad: "yes" },
        viewport: { x: 0, y: 0, zoom: 0 },
      }),
    );
    expect(parsed.source).toBe("ok");
    expect(parsed.layout.nodes).toEqual({ good: { x: 1, y: 2 } });
    expect(parsed.layout.hiddenEdges).toEqual(["fk"]);
    expect(parsed.layout.collapsed).toEqual({ good: true });
    expect(parsed.layout.viewport).toBeUndefined();
  });
});

describe("serializeGraphLayout", () => {
  it("writes stable, sorted bytes and drops unknown ids on round-trip", () => {
    const value = layout({
      nodes: {
        "table:z": { x: 2, y: 1 },
        "table:a": { x: 1, y: 2 },
      },
      hiddenEdges: ["page-route", "fk"],
      collapsed: { "table:z": true },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const text = serializeGraphLayout(value);
    expect(text.endsWith("\n")).toBe(true);
    expect(serialized(value)).toEqual({
      version: GRAPH_LAYOUT_VERSION,
      nodes: {
        "table:a": { x: 1, y: 2 },
        "table:z": { x: 2, y: 1 },
      },
      hiddenEdges: ["fk", "page-route"],
      collapsed: { "table:z": true },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(serializeGraphLayout(parseGraphLayout(text).layout)).toBe(text);
  });

  it("omits the viewport when the user has never moved the canvas", () => {
    expect(serialized(emptyGraphLayout())).toEqual({
      version: 1,
      nodes: {},
      hiddenEdges: [],
      collapsed: {},
    });
  });
});

describe("mergeGraphLayout", () => {
  it("keeps only ids the current analysis reports", () => {
    const value = layout({
      nodes: { "table:todos": { x: 1, y: 2 }, "table:gone": { x: 3, y: 4 } },
      collapsed: { "table:todos": true, "table:gone": false },
      hiddenEdges: ["fk", "relation"],
      viewport: { x: 1, y: 1, zoom: 1 },
    });
    const merged = mergeGraphLayout(value, {
      nodeIds: new Set(["table:todos"]),
      edgeKinds: ["fk"],
    });
    expect(merged.nodes).toEqual({ "table:todos": { x: 1, y: 2 } });
    expect(merged.collapsed).toEqual({ "table:todos": true });
    expect(merged.hiddenEdges).toEqual(["fk"]);
    expect(merged.viewport).toEqual({ x: 1, y: 1, zoom: 1 });
  });
});

describe("layout mutations", () => {
  it("moves one node without mutating the previous layout", () => {
    const before = layout();
    const after = withNodePosition(before, "table:todos", { x: 12, y: 34 });
    expect(after.nodes).toEqual({ "table:todos": { x: 12, y: 34 } });
    expect(before.nodes).toEqual({});
    expect(after).not.toBe(before);
  });

  it("ignores a non-finite drag position", () => {
    const before = layout();
    expect(withNodePosition(before, "table:todos", { x: Number.NaN, y: 1 })).toBe(before);
  });

  it("toggles hidden edge kinds in canonical order", () => {
    let value = layout();
    value = withHiddenEdgeKind(value, "page-route", true);
    value = withHiddenEdgeKind(value, "fk", true);
    expect(value.hiddenEdges).toEqual(["fk", "page-route"]);
    value = withHiddenEdgeKind(value, "fk", false);
    expect(value.hiddenEdges).toEqual(["page-route"]);
    expect(value.hiddenEdges.every((kind) => GRAPH_EDGE_KINDS.includes(kind))).toBe(true);
  });

  it("collapses and expands a table and stores the viewport", () => {
    let value = withCollapsed(layout(), "table:todos", true);
    expect(value.collapsed).toEqual({ "table:todos": true });
    value = withCollapsed(value, "table:todos", false);
    expect(value.collapsed).toEqual({ "table:todos": false });
    value = withViewport(value, { x: 4, y: 5, zoom: 0.5 });
    expect(value.viewport).toEqual({ x: 4, y: 5, zoom: 0.5 });
    expect(withViewport(value, { x: 0, y: 0, zoom: 0 })).toBe(value);
  });

  it("resets positions and collapsed state but keeps the edge filters", () => {
    const value = layout({
      nodes: { "table:todos": { x: 1, y: 2 } },
      collapsed: { "table:todos": true },
      hiddenEdges: ["relation"],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(resetGraphLayoutPositions(value)).toEqual({
      version: 1,
      nodes: {},
      hiddenEdges: ["relation"],
      collapsed: {},
    });
  });
});

function fakeController(files: Record<string, string>) {
  const writes: { type: string; path: string; contents?: string }[] = [];
  const controller = {
    readFileText: async (path: string) => files[path] ?? "",
    pathInfo: async (path: string) => ({ exists: path in files, isDir: false }),
    bridge: {
      request: async (type: string, extra?: Record<string, unknown>) => {
        const path = String(extra?.path ?? "");
        writes.push({
          type,
          path,
          contents: typeof extra?.contents === "string" ? extra.contents : undefined,
        });
        if (type === "vv-write") files[path] = String(extra?.contents ?? "");
        return { type: "vv-reply", ok: true };
      },
    },
  };
  return { controller: controller as unknown as IdeController, writes, files };
}

describe("layout file IO", () => {
  const ROOT = "/w/app";

  it("reads the saved layout through the VFS", async () => {
    const { controller } = fakeController({
      [graphLayoutPath(ROOT)]: JSON.stringify({ version: 1, nodes: { a: { x: 1, y: 2 } } }),
    });
    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.source).toBe("ok");
    expect(loaded.layout.nodes).toEqual({ a: { x: 1, y: 2 } });
  });

  it("treats a missing file as a missing layout", async () => {
    const { controller } = fakeController({});
    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.source).toBe("missing");
    expect(loaded.layout).toEqual(emptyGraphLayout());
  });

  it("creates .facilis, its .gitignore and the layout file on save", async () => {
    const { controller, writes, files } = fakeController({});
    const value = withNodePosition(emptyGraphLayout(), "table:todos", { x: 7, y: 8 });
    await saveGraphLayout(controller, ROOT, value);
    expect(writes.map((write) => write.type)).toEqual(["vv-mkdirp", "vv-write", "vv-write"]);
    expect(writes[1]?.path).toBe(ROOT + "/.facilis/.gitignore");
    expect(writes[2]?.path).toBe(graphLayoutPath(ROOT));
    expect(files[graphLayoutPath(ROOT)]).toBe(serializeGraphLayout(value));
    expect(files[ROOT + "/.facilis/.gitignore"]).toBe("*\n");
  });

  it("does not overwrite an existing .facilis/.gitignore", async () => {
    const ignorePath = ROOT + "/.facilis/.gitignore";
    const { controller, writes } = fakeController({ [ignorePath]: "custom\n" });
    await saveGraphLayout(controller, ROOT, emptyGraphLayout());
    expect(writes.some((write) => write.path === ignorePath)).toBe(false);
  });
});
