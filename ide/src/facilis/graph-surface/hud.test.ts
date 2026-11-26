// Observation-only HUD state on the graph surface root (#182/#144): mode, real column count,
// camera, free content box and selected-node screen rect. The mobile gate fails if detail
// swimlanes reflow; the overlap gate fails if a card or node lands under the top HUD.

import { describe, expect, it } from "vitest";
import { selectedScreenRect, selectedScreenY, surfaceColumns, writeSurfaceHud } from "./hud.ts";
import type { DetailScene, OverviewScene } from "./scene.ts";

const camera = { tx: 10, ty: 20, scale: 2 };
const view = { width: 1000, height: 700 };
const insets = { top: 88, right: 320, bottom: 0 };

function overview(xs: readonly number[]): OverviewScene {
  return {
    mode: "overview",
    nodes: [],
    domainOf: new Map(),
    layout: {
      cards: xs.map((x) => ({
        name: "d" + x,
        rect: { x, y: 0, w: 240, h: 150 },
        counts: { page: 0, route: 0, table: 0, view: 0, workflow: 0 },
        total: 0,
        links: 0,
      })),
      links: [],
      bounds: { x: 0, y: 0, w: 100, h: 100 },
    },
  };
}

function detail(): DetailScene {
  const positions = new Map([
    ["page:/todos", { x: 0, y: -40, w: 216, h: 56 }],
    ["route:GET /todos", { x: 366, y: -40, w: 216, h: 56 }],
    ["table:todos", { x: 732, y: -40, w: 216, h: 56 }],
  ]);
  return {
    mode: "detail",
    domain: "todos",
    layout: {
      positions,
      headers: [],
      ports: [],
      edges: [],
      bounds: { x: 0, y: -40, w: 948, h: 56 },
    },
    columns: [0, 366, 732],
    nodeById: new Map(),
    neighbors: new Map(),
  };
}

describe("surfaceColumns", () => {
  it("counts overview grid columns from the card x positions", () => {
    expect(surfaceColumns(overview([0, 370, 740, 0, 370, 740]))).toBe(3);
    expect(surfaceColumns(overview([0, 370]))).toBe(2);
  });

  it("counts the detail swimlane columns, never collapsing them into one", () => {
    expect(surfaceColumns(detail())).toBe(3);
  });
});

describe("selectedScreenY / selectedScreenRect", () => {
  it("projects the node centre and rect through the camera", () => {
    expect(selectedScreenY(detail(), camera, "table:todos")).toBe(20 + (-40 + 28) * 2);
    expect(selectedScreenRect(detail(), camera, "page:/todos")).toEqual({
      x: 10,
      y: 20 + -40 * 2,
      w: 432,
      h: 112,
    });
    expect(selectedScreenY(detail(), camera, null)).toBeNull();
    expect(selectedScreenRect(detail(), camera, "missing")).toBeNull();
    expect(selectedScreenRect(overview([0]), camera, "page:/todos")).toBeNull();
  });
});

describe("writeSurfaceHud", () => {
  it("publishes mode, domain, columns, camera, content box, HUD top and selected rect", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    writeSurfaceHud(root, detail(), camera, "page:/todos", view, insets);
    expect(root.dataset.graphMode).toBe("detail");
    expect(root.dataset.graphDomain).toBe("todos");
    expect(root.dataset.graphColumns).toBe("3");
    expect(root.dataset.graphCamera).toBe("10.00,20.00,2.000");
    // The free content box starts below the top HUD and stops at the side drawer.
    expect(root.dataset.graphContent).toBe("0,88,680,612");
    expect(root.dataset.graphHudTop).toBe("88");
    expect(root.dataset.graphSelectedRect).toBe("10,-60,432,112");
    expect(root.dataset.graphBounds).toBe("10,-60,1896,112");
    expect(Number(root.dataset.graphSelectedY)).toBe(20 + (-40 + 28) * 2);
  });

  it("clears the domain and the selection in the overview and tolerates no root", () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    writeSurfaceHud(root, overview([0, 370]), { tx: 0, ty: 0, scale: 1 }, null, view, {
      top: 88,
      right: 0,
      bottom: 0,
    });
    expect(root.dataset.graphMode).toBe("overview");
    expect(root.dataset.graphDomain).toBe("");
    expect(root.dataset.graphColumns).toBe("2");
    expect(root.dataset.graphSelectedY).toBe("");
    expect(root.dataset.graphSelectedRect).toBe("");
    expect(root.dataset.graphContent).toBe("0,88,1000,612");
    expect(root.dataset.graphBounds).toBe("0,0,100,100");
    expect(() =>
      writeSurfaceHud(null, overview([]), camera, null, view, { top: 0, right: 0, bottom: 0 }),
    ).not.toThrow();
  });
});
