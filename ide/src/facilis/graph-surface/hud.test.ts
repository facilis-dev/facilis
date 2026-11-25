// Observation-only HUD state on the graph surface root (#182): mode, real column count,
// camera and selected-node screen position. The mobile gate fails if detail swimlanes reflow.

import { describe, expect, it } from "vitest";
import { selectedScreenY, surfaceColumns, writeSurfaceHud } from "./hud.ts";
import type { DetailScene, OverviewScene } from "./scene.ts";

const camera = { tx: 10, ty: 20, scale: 2 };

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

describe("selectedScreenY", () => {
  it("projects the node centre through the camera", () => {
    expect(selectedScreenY(detail(), camera, "table:todos")).toBe(20 + (-40 + 28) * 2);
    expect(selectedScreenY(detail(), camera, null)).toBeNull();
    expect(selectedScreenY(detail(), camera, "missing")).toBeNull();
  });
});

describe("writeSurfaceHud", () => {
  it("publishes mode, domain, columns, camera and the selected screen y", () => {
    const root = { dataset: {} as Record<string, string> };
    writeSurfaceHud(root, detail(), camera, "page:/todos");
    expect(root.dataset.graphMode).toBe("detail");
    expect(root.dataset.graphDomain).toBe("todos");
    expect(root.dataset.graphColumns).toBe("3");
    expect(root.dataset.graphCamera).toBe("10.00,20.00,2.000");
    expect(Number(root.dataset.graphSelectedY)).toBe(20 + (-40 + 28) * 2);
  });

  it("clears the domain and the selection in the overview and tolerates no root", () => {
    const root = { dataset: {} as Record<string, string> };
    writeSurfaceHud(root, overview([0, 370]), { tx: 0, ty: 0, scale: 1 }, null);
    expect(root.dataset.graphMode).toBe("overview");
    expect(root.dataset.graphDomain).toBe("");
    expect(root.dataset.graphColumns).toBe("2");
    expect(root.dataset.graphSelectedY).toBe("");
    expect(() => writeSurfaceHud(null, overview([]), camera, null)).not.toThrow();
  });
});
