// Draw-level guarantees of the map-and-lens surface (D-211, issues #184/#186): offscreen nodes
// are culled (no draw calls for them), search matches DIM cards instead of hiding them, and
// selection is pure draw state — the scene's node objects are never rebuilt or mutated.
import { beforeEach, describe, expect, it } from "vitest";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { initI18n, setLocale } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import { deriveDomains, domainIndex } from "./domains.ts";
import { focusHops, focusNeighborhood } from "./focus.ts";
import type { SurfacePalette } from "./palette.ts";
import { rectVisible, visibleWorldRect } from "./render.ts";
import {
  buildDetailScene,
  buildOverviewScene,
  drawSurface,
  type SurfaceInteraction,
} from "./scene.ts";

function node(kind: GraphNodeKind, id: string): ProjectGraphNode {
  const base = {
    id,
    kind,
    label: id,
    sourceFile: "db/schema.ts",
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
  };
  switch (kind) {
    case "page":
      return {
        ...base,
        data: {
          kind,
          pagePath: "/" + id,
          pageKind: "page",
          callCount: 0,
          routePaths: [],
          preview: null,
        },
      };
    case "route":
      return {
        ...base,
        data: {
          kind,
          method: "GET",
          // Root path: routeGroup finds no segment, so every fixture node lands in "core".
          path: "/",
          permission: [],
          wrapper: "valid",
          description: null,
          input: { body: false, form: false, query: false, params: false },
          pathParams: [],
          dbTables: [],
          elevations: [],
          unknown: false,
        },
      };
    case "table":
      return {
        ...base,
        data: {
          kind,
          table: id,
          columns: [],
          rlsEnabled: true,
          framework: false,
          scope: null,
          policies: [],
          unknown: false,
        },
      };
    case "view":
      return {
        ...base,
        data: {
          kind,
          view: id,
          tables: [],
          permission: null,
          access: "invoker",
          unknown: false,
          usedByRoutes: [],
        },
      };
    case "workflow":
      return { ...base, data: { kind, name: id, steps: [], unknown: false } };
  }
}

const PALETTE: SurfacePalette = {
  background: "#000",
  card: "#111",
  cardActive: "#222",
  foreground: "#fff",
  muted: "#888",
  border: "#333",
  accent: "#0ff",
  elevated: "#f80",
  kinds: { page: "#0f0", route: "#00f", table: "#ff0", view: "#f0f", workflow: "#0ff" },
  edges: {
    fk: "#0ff",
    relation: "#00f",
    "route-table": "#888",
    "page-route": "#0f0",
    "page-link": "#0ff",
    "route-view": "#00f",
    "view-base": "#888",
  },
};

interface RecordedCall {
  method: string;
  args: unknown[];
}

/** A recording 2D context: every method call and property assignment is captured. */
function fakeCtx() {
  const calls: RecordedCall[] = [];
  const sets: { prop: string; value: unknown }[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "measureText") return (text: string) => ({ width: text.length * 7 });
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
      };
    },
    set(_target, prop, value) {
      if (typeof prop === "string") sets.push({ prop, value });
      return true;
    },
  });
  return { ctx, calls, sets };
}

function drawnTexts(calls: RecordedCall[]): string[] {
  return calls.filter((call) => call.method === "fillText").map((call) => String(call.args[0]));
}

const NODES = [node("page", "p1"), node("route", "r1"), node("table", "t1"), node("table", "t2")];
const EDGES: ProjectGraphEdge[] = [
  { id: "e1", kind: "page-route", source: "p1", target: "r1", label: null },
  { id: "e2", kind: "route-table", source: "r1", target: "t1", label: null },
];
const CAMERA = { tx: 0, ty: 0, scale: 1 };
const VIEW = { width: 400, height: 300, dpr: 1 };

function interaction(overrides: Partial<SurfaceInteraction> = {}): SurfaceInteraction {
  return {
    hoverId: null,
    selectedId: null,
    query: "",
    matched: new Set<string>(),
    focus: null,
    ...overrides,
  };
}

/** t1 on screen, t2 far outside the viewport: the culling pair. */
function culledScene() {
  const domainOf = domainIndex(deriveDomains(NODES, EDGES));
  return buildDetailScene("core", NODES, domainOf, EDGES, {
    t1: { x: 20, y: 20 },
    t2: { x: 5000, y: 5000 },
  });
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("viewport culling", () => {
  it("rectVisible skips offscreen rects and keeps onscreen ones (with pad)", () => {
    const visible = visibleWorldRect(CAMERA, VIEW.width, VIEW.height);
    expect(rectVisible({ x: 20, y: 20, w: 200, h: 90 }, visible)).toBe(true);
    expect(rectVisible({ x: 5000, y: 5000, w: 200, h: 90 }, visible)).toBe(false);
    // Just outside the viewport but inside the 80px pad: still drawn (cheap, avoids pop-in).
    expect(rectVisible({ x: 420, y: 20, w: 200, h: 90 }, visible)).toBe(true);
    expect(rectVisible({ x: 900, y: 20, w: 200, h: 90 }, visible)).toBe(false);
  });

  it("offscreen detail nodes produce no draw calls", () => {
    const scene = culledScene();
    const { ctx, calls } = fakeCtx();
    drawSurface(ctx, scene, CAMERA, VIEW, PALETTE, interaction());
    const texts = drawnTexts(calls);
    expect(texts).toContain("t1");
    expect(texts).not.toContain("t2");
  });

  it("offscreen overview cards produce no text draw calls", () => {
    const domains = deriveDomains(NODES, EDGES);
    const scene = buildOverviewScene(domains, NODES, EDGES);
    const { ctx, calls } = fakeCtx();
    drawSurface(ctx, scene, { tx: -100000, ty: -100000, scale: 1 }, VIEW, PALETTE, interaction());
    expect(drawnTexts(calls)).toHaveLength(0);
  });
});

describe("search dims, never hides", () => {
  it("non-matching nodes are still drawn, at a reduced alpha", () => {
    // Both cards on screen: dimming must not be confused with culling.
    const domainOf = domainIndex(deriveDomains(NODES, EDGES));
    const scene = buildDetailScene("core", NODES, domainOf, EDGES, {
      t1: { x: 20, y: 20 },
      t2: { x: 20, y: 150 },
    });
    const { ctx, calls, sets } = fakeCtx();
    drawSurface(
      ctx,
      scene,
      CAMERA,
      VIEW,
      PALETTE,
      interaction({ query: "t1", matched: new Set(["t1"]) }),
    );
    const texts = drawnTexts(calls);
    // Both visible cards are drawn: the match dims t2, it does not hide it.
    expect(texts).toContain("t1");
    expect(texts.some((text) => text.startsWith("t2"))).toBe(true);
    expect(sets.some((entry) => entry.prop === "globalAlpha" && entry.value === 0.2)).toBe(true);
  });
});

describe("selection focus dims the neighbourhood", () => {
  it("keeps the page's routes and their tables bright, dims the rest", () => {
    const domainOf = domainIndex(deriveDomains(NODES, EDGES));
    const scene = buildDetailScene("core", NODES, domainOf, EDGES, {
      p1: { x: 20, y: 20 },
      r1: { x: 260, y: 20 },
      t1: { x: 500, y: 20 },
      t2: { x: 740, y: 20 },
    });
    const focus = focusNeighborhood(scene.neighbors, "p1", focusHops("page"));
    expect([...focus].toSorted()).toEqual(["p1", "r1", "t1"]);
    const { ctx, sets } = fakeCtx();
    drawSurface(
      ctx,
      scene,
      { tx: 0, ty: 0, scale: 1 },
      { width: 1200, height: 300, dpr: 1 },
      PALETTE,
      interaction({ selectedId: "p1", focus }),
    );
    // t2 is outside the 2-hop neighbourhood: drawn, never hidden, at the focus alpha.
    expect(sets.some((entry) => entry.prop === "globalAlpha" && entry.value === 0.12)).toBe(true);
  });
});

describe("selection is draw state only", () => {
  it("selecting nodes changes the frame, never the scene's node objects", () => {
    const scene = culledScene();
    const nodesBefore = [...scene.nodeById.values()];
    const first = fakeCtx();
    drawSurface(first.ctx, scene, CAMERA, VIEW, PALETTE, interaction({ selectedId: "t1" }));
    // The selected card is stroked with the thicker highlight line.
    expect(first.sets.some((entry) => entry.prop === "lineWidth" && entry.value === 2)).toBe(true);
    const second = fakeCtx();
    drawSurface(second.ctx, scene, CAMERA, VIEW, PALETTE, interaction({ selectedId: "r1" }));
    expect([...scene.nodeById.values()]).toEqual(nodesBefore);
    for (const [id, value] of scene.nodeById) {
      expect(value).toBe(nodesBefore.find((entry) => entry.id === id));
    }
    expect(drawnTexts(second.calls)).toContain("t1");
  });
});
