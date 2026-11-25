// The node-drag pipeline and its persistence (D-211, issue #185, D-126/D-127): grab math, live
// follow, snap-to-column release, and the round-trip through the real per-element state files —
// a dragged position writes one small file, survives reload as an override, and never snaps back.
import { describe, expect, it } from "vitest";
import type { IdeController } from "@/vv/controller";
import {
  GRAPH_POSITIONS_DIR,
  GRAPH_VIEWPORT_PATH,
  emptyGraphLayout,
  type GraphLayoutFile,
} from "../graph-layout-file.ts";
import {
  elementPath,
  loadGraphLayout,
  saveGraphLayout,
  withNodePosition,
  withViewport,
} from "../graph-layout.ts";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import { roundCoordinate } from "../graph-layout-file.ts";
import { restoreCamera } from "./camera.ts";
import { dragPosition, endNodeDrag, startNodeDrag } from "./drag.ts";
import { buildDetailScene, type DetailScene } from "./scene.ts";

function node(kind: ProjectGraphNode["kind"], id: string): ProjectGraphNode {
  const base = {
    id,
    kind,
    label: id,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
  };
  switch (kind) {
    case "page":
      return { ...base, data: { kind, pagePath: "/" + id, pageKind: "page", callCount: 0, routePaths: [], preview: null } };
    case "route":
      return {
        ...base,
        data: { kind, method: "GET", path: "/" + id, permission: [], wrapper: "valid", description: null, input: { body: false, form: false, query: false, params: false }, pathParams: [], dbTables: [], elevations: [], unknown: false },
      };
    case "table":
      return { ...base, data: { kind, table: id, columns: [], rlsEnabled: true, framework: false, scope: null, policies: [], unknown: false } };
    default:
      return { ...base, data: { kind: "view", view: id, tables: [], permission: null, access: "invoker", unknown: false, usedByRoutes: [] } };
  }
}

const edge = (id: string, kind: ProjectGraphEdge["kind"], source: string, target: string): ProjectGraphEdge => ({ id, kind, source, target, label: null });

function sceneOf(nodes: readonly ProjectGraphNode[], edges: readonly ProjectGraphEdge[], domainOf: Map<string, string>, domain = "core"): DetailScene {
  return buildDetailScene(domain, nodes, domainOf, edges);
}

const NODES = [node("page", "p1"), node("page", "p2"), node("route", "r1"), node("table", "t1")];
const EDGES = [edge("e1", "page-route", "p1", "r1"), edge("e2", "route-table", "r1", "t1")];
const ALL_CORE = new Map(NODES.map((entry) => [entry.id, "core"] as const));

const ROOT = "/w/app";

function fakeController(files: Record<string, string>) {
  const writes: { type: string; path: string; contents?: string }[] = [];
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
    pathInfo: async (path: string) => ({ exists: path in files, isDir: false }),
    bridge: {
      request: async (type: string, extra?: Record<string, unknown>) => {
        const path = String(extra?.path ?? "");
        const contents = typeof extra?.contents === "string" ? extra.contents : undefined;
        writes.push({ type, path, contents });
        if (type === "vv-write") files[path] = contents ?? "";
        if (type === "vv-rm") delete files[path];
        return { type: "vv-reply", ok: true };
      },
    },
  };
  return { controller: controller as unknown as IdeController, writes, files };
}

describe("startNodeDrag", () => {
  it("grabs a detail node with the pointer-to-origin offset", () => {
    const scene = sceneOf(NODES, EDGES, ALL_CORE);
    const rect = scene.layout.positions.get("p1")!; // p1 is a fixture member.
    const drag = startNodeDrag(scene, rect.x + 10, rect.y + 12);
    expect(drag).not.toBeNull();
    expect(drag?.id).toBe("p1");
    expect(drag?.offsetX).toBe(10);
    expect(drag?.offsetY).toBe(12);
    expect(drag?.origin).toEqual(rect);
  });

  it("returns null on empty space and on a cross-domain port", () => {
    const scene = sceneOf(NODES, EDGES, ALL_CORE);
    expect(startNodeDrag(scene, 100000, 100000)).toBeNull();
    // A cross-domain edge creates a labelled port; grabbing it navigates, it does not drag.
    const crossNodes = [node("page", "p1"), node("route", "r1")];
    const crossDomain = new Map([["p1", "core"], ["r1", "other"]]);
    const cross = sceneOf(crossNodes, [edge("x", "page-route", "p1", "r1")], crossDomain);
    const port = cross.layout.ports[0]!; // the cross edge guarantees one port.
    expect(startNodeDrag(cross, port.rect.x + 5, port.rect.y + 5)).toBeNull();
  });
});

describe("dragPosition / endNodeDrag", () => {
  it("follows the pointer minus the grab offset (live edge follow)", () => {
    const scene = sceneOf(NODES, EDGES, ALL_CORE);
    const rect = scene.layout.positions.get("p1")!; // fixture member.
    const drag = startNodeDrag(scene, rect.x + 10, rect.y + 10)!;
    expect(dragPosition(drag, rect.x + 110, rect.y + 60)).toEqual({ x: rect.x + 100, y: rect.y + 50 });
  });

  it("release snaps x to a lane column and keeps the dropped y", () => {
    const scene = sceneOf(NODES, EDGES, ALL_CORE);
    const rect = scene.layout.positions.get("p1")!; // fixture member.
    const drag = startNodeDrag(scene, rect.x + 10, rect.y + 10)!;
    const drop = endNodeDrag(drag, scene, rect.x + 410, rect.y + 88.888);
    expect(scene.columns).toContain(drop.x);
    // The drop is the pointer minus the grab offset (10), rounded to the persisted precision.
    expect(drop.y).toBe(roundCoordinate(rect.y + 78.888));
  });
});

describe("drag persistence round-trip (D-126 / D-127)", () => {
  it("writes one position file, survives reload, and overrides the automatic placement", async () => {
    const { controller, writes } = fakeController({});
    const auto = sceneOf(NODES, EDGES, ALL_CORE);
    const rect = auto.layout.positions.get("p1")!; // fixture member.
    const drag = startNodeDrag(auto, rect.x + 10, rect.y + 10)!;
    const snapped = endNodeDrag(drag, auto, rect.x + 410, 77.7);
    const layout = withNodePosition(emptyGraphLayout(), "p1", snapped);
    await saveGraphLayout(controller, ROOT, layout);

    const positionWrites = writes.filter((write) => write.type === "vv-write" && write.path.startsWith(ROOT + "/" + GRAPH_POSITIONS_DIR + "/"));
    expect(positionWrites.map((write) => write.path)).toEqual([ROOT + "/" + elementPath("p1")]);

    const loaded = await loadGraphLayout(controller, ROOT);
    expect(loaded.layout.nodes["p1"]).toEqual({ x: snapped.x, y: snapped.y });
    const rebuilt = buildDetailScene("core", NODES, ALL_CORE, EDGES, loaded.layout.nodes);
    expect(rebuilt.layout.positions.get("p1")).toMatchObject({ x: snapped.x, y: snapped.y });
    expect(rebuilt.layout.positions.get("p1")).not.toEqual(rect);
    // Unrelated nodes keep their automatic placement: no snap-back, no sibling shift.
    expect(rebuilt.layout.positions.get("r1")).toEqual(auto.layout.positions.get("r1"));
  });

  it("a second save with no change writes nothing (diff save)", async () => {
    const { controller, writes } = fakeController({});
    const layout = withNodePosition(emptyGraphLayout(), "p1", { x: 500, y: 40 });
    await saveGraphLayout(controller, ROOT, layout);
    writes.length = 0;
    await saveGraphLayout(controller, ROOT, layout, layout);
    expect(writes.filter((write) => write.type === "vv-write")).toHaveLength(0);
  });

  it("moving two nodes writes two independent files (merge-friendly)", async () => {
    const { controller, writes } = fakeController({});
    let layout: GraphLayoutFile = emptyGraphLayout();
    layout = withNodePosition(layout, "p1", { x: 500, y: 40 });
    layout = withNodePosition(layout, "r1", { x: 900, y: -20 });
    await saveGraphLayout(controller, ROOT, layout);
    const paths = writes.filter((write) => write.type === "vv-write").map((write) => write.path);
    expect(paths).toContain(ROOT + "/" + elementPath("p1"));
    expect(paths).toContain(ROOT + "/" + elementPath("r1"));
    expect(elementPath("p1")).not.toBe(elementPath("r1"));
  });

  it("the saved viewport round-trips to viewport.json and restores on open", async () => {
    const { controller, writes } = fakeController({});
    const layout = withViewport(emptyGraphLayout(), { x: 200, y: -80, zoom: 1.75 });
    await saveGraphLayout(controller, ROOT, layout);
    expect(writes.some((write) => write.path === ROOT + "/" + GRAPH_VIEWPORT_PATH)).toBe(true);
    const loaded = await loadGraphLayout(controller, ROOT);
    const camera = restoreCamera({ saved: loaded.layout.viewport, bounds: { x: 0, y: 0, w: 800, h: 600 }, width: 1000, height: 800 });
    expect(camera).toEqual({ tx: 200, ty: -80, scale: 1.75 });
  });
});
