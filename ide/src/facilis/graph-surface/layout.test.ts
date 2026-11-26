// Layout invariants (issue #184): determinism (same input -> identical positions), the overview
// grid, swimlane detail with workflows below, one edge per connection, port placement, and the
// camera fit/zoom math. No screen-size input exists, so desktop and mobile cannot diverge.
import { describe, expect, it } from "vitest";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { ProjectGraphEdge, ProjectGraphNode } from "../graph-types.ts";
import type { GraphDomain } from "./domains.ts";
import { OVERVIEW_CARD_H, OVERVIEW_CARD_W, overviewLayout } from "./layout.ts";
import { DETAIL_CARD_H, DETAIL_CARD_W, PORT_H, PORT_W, detailLayout } from "./detail.ts";
import { SURFACE_MIN_FIT_SCALE, fitCamera, worldPoint, zoomCamera } from "./camera.ts";

function node(kind: GraphNodeKind, id: string, label = id): ProjectGraphNode {
  const base = {
    id,
    kind,
    label,
    sourceFile: null,
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
          path: "/" + id,
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

function edge(
  id: string,
  kind: ProjectGraphEdge["kind"],
  source: string,
  target: string,
  elevated = false,
): ProjectGraphEdge {
  return {
    id,
    kind,
    source,
    target,
    label: null,
    ...(elevated ? { access: "elevated" as const } : {}),
  };
}

function domainsOf(...entries: [string, string[]][]): GraphDomain[] {
  return entries.map(([name, nodeIds]) => ({ name, nodeIds }));
}

function indexOf(domains: readonly GraphDomain[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const domain of domains) for (const id of domain.nodeIds) map.set(id, domain.name);
  return map;
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("overviewLayout", () => {
  const domains = domainsOf(["admin", ["p1", "r1"]], ["core", ["t1"]], ["shop", ["p2"]]);
  const nodes = [node("page", "p1"), node("route", "r1"), node("table", "t1"), node("page", "p2")];
  const edges = [
    edge("e1", "page-route", "p1", "r1"),
    edge("e2", "route-table", "r1", "t1"),
    edge("e3", "route-table", "r1", "t1"),
  ];

  it("places one non-overlapping card per domain on a centered grid", () => {
    const layout = overviewLayout(domains, nodes, edges);
    expect(layout.cards).toHaveLength(3);
    for (let i = 0; i < layout.cards.length; i++) {
      for (let j = i + 1; j < layout.cards.length; j++) {
        expect(overlaps(layout.cards[i]!.rect, layout.cards[j]!.rect)).toBe(false);
      }
    }
    for (const card of layout.cards) {
      expect(card.rect.w).toBe(OVERVIEW_CARD_W);
      expect(card.rect.h).toBe(OVERVIEW_CARD_H);
    }
    expect(layout.bounds.w).toBeGreaterThan(0);
  });

  it("counts kinds and aggregates cross-domain links with counts", () => {
    const layout = overviewLayout(domains, nodes, edges);
    const admin = layout.cards.find((card) => card.name === "admin");
    expect(admin?.counts.page).toBe(1);
    expect(admin?.counts.route).toBe(1);
    expect(admin?.total).toBe(2);
    // r1 -> t1 crosses admin -> core twice; both directions aggregate into one link.
    const cross = layout.links.filter((link) => link.a === "admin" && link.b === "core");
    expect(cross).toHaveLength(1);
    expect(cross[0]?.count).toBe(2);
    // The intra-domain page-route edge is not a cross-domain link.
    expect(layout.links.every((link) => link.a !== link.b)).toBe(true);
  });

  it("stays a multi-column grid at a 390px wide viewport (anti-reflow)", () => {
    const wide = domainsOf(
      ["a", ["pa"]],
      ["b", ["pb"]],
      ["c", ["pc"]],
      ["d", ["pd"]],
      ["e", ["pe"]],
      ["f", ["pf"]],
    );
    const flat = overviewLayout(
      wide,
      wide.map((domain) => node("page", domain.nodeIds[0]!)),
      [],
    );
    const columns = new Set(flat.cards.map((card) => card.rect.x));
    const rows = new Set(flat.cards.map((card) => card.rect.y));
    expect(columns.size).toBeGreaterThan(1);
    expect(rows.size).toBeGreaterThan(1);
    // No screen-size input reaches the layout: a phone uses the same grid, only panned.
    expect(flat.bounds.w).toBeGreaterThan(390);
  });

  it("is deterministic: same input, identical positions and links", () => {
    const a = overviewLayout(domains, nodes, edges);
    const b = overviewLayout(domains, nodes, edges);
    expect(a).toEqual(b);
    const shuffled = overviewLayout(domains, [...nodes].reverse(), [...edges].reverse());
    expect(shuffled.cards).toEqual(a.cards);
    expect(shuffled.links).toEqual(a.links);
  });
});

describe("detailLayout", () => {
  const domains = domainsOf(
    ["admin", ["p1", "r1", "r2", "t1", "v1", "w1"]],
    ["shop", ["r3", "t2"]],
  );
  const domainOf = indexOf(domains);
  const nodes = [
    node("page", "p1"),
    node("route", "r1"),
    node("route", "r2"),
    node("table", "t1"),
    node("view", "v1"),
    node("workflow", "w1"),
    node("route", "r3"),
    node("table", "t2"),
  ];
  const edges = [
    edge("e1", "page-route", "p1", "r1"),
    edge("e2", "route-table", "r1", "t1"),
    edge("e3", "route-table", "r1", "t1"),
    edge("e4", "route-view", "r2", "v1"),
    edge("e5", "route-table", "r2", "t2"),
    edge("e6", "page-route", "r3", "p1"),
  ];
  const input = { domain: "admin", nodes, domainOf, edges };

  it("keeps the pages | routes | data columns at a 390px wide viewport (anti-reflow)", () => {
    const layout = detailLayout(input);
    const page = layout.positions.get("p1")!;
    const route = layout.positions.get("r1")!;
    const table = layout.positions.get("t1")!;
    // Three distinct columns still exist: narrow screens pan them, they never stack.
    expect(new Set([page.x, route.x, table.x]).size).toBe(3);
    expect(page.x).toBeLessThan(route.x);
    expect(route.x).toBeLessThan(table.x);
    const camera = fitCamera(layout.bounds, 390, 844, { insetBottom: 368 });
    expect(camera.scale).toBeGreaterThanOrEqual(SURFACE_MIN_FIT_SCALE);
    // At the readable floor the columns are wider than the phone viewport: pannable, not reflowed.
    expect(layout.bounds.w * camera.scale).toBeGreaterThan(390);
  });

  it("lays out horizontal swimlanes pages | routes | data with workflows below", () => {
    const layout = detailLayout(input);
    const page = layout.positions.get("p1")!;
    const route = layout.positions.get("r1")!;
    const table = layout.positions.get("t1")!;
    const view = layout.positions.get("v1")!;
    const workflow = layout.positions.get("w1")!;
    expect(page.x).toBeLessThan(route.x);
    expect(route.x).toBeLessThan(table.x);
    // Tables and views share the data lane.
    expect(table.x).toBe(view.x);
    expect(page.w).toBe(DETAIL_CARD_W);
    expect(page.h).toBe(DETAIL_CARD_H);
    // Workflows sit below every swimlane card.
    const laneBottom = Math.max(...[page, route, table, view].map((rect) => rect.y + rect.h));
    expect(workflow.y).toBeGreaterThan(laneBottom);
    expect(layout.headers.map((header) => header.lane)).toEqual([
      "page",
      "route",
      "data",
      "workflow",
    ]);
  });

  it("never overlaps cards inside a lane", () => {
    const layout = detailLayout(input);
    const rects = [...layout.positions.values()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  it("draws one distinct edge per connection, preferring the elevated variant", () => {
    const layout = detailLayout(input);
    const r1t1 = layout.edges.filter((e) => e.source === "r1" && e.target === "t1");
    expect(r1t1).toHaveLength(1);
    const elevatedInput = {
      ...input,
      edges: [...edges, edge("e7", "route-table", "r1", "t1", true)],
    };
    const elevated = detailLayout(elevatedInput).edges.find(
      (e) => e.source === "r1" && e.target === "t1",
    );
    expect(elevated?.access).toBe("elevated");
    // Cross-domain edges are not internal edges.
    expect(layout.edges.some((e) => e.source === "r3" || e.target === "r3")).toBe(false);
  });

  it("places labelled ports for cross-domain links: out right, in left, bounds include them", () => {
    const layout = detailLayout(input);
    const out = layout.ports.find((port) => port.direction === "out");
    const inc = layout.ports.find((port) => port.direction === "in");
    expect(out?.domain).toBe("shop");
    expect(out?.links).toEqual(["r2"]);
    expect(inc?.domain).toBe("shop");
    expect(inc?.links).toEqual(["p1"]);
    const cardsRight = Math.max(...[...layout.positions.values()].map((rect) => rect.x + rect.w));
    const cardsLeft = Math.min(...[...layout.positions.values()].map((rect) => rect.x));
    expect(out!.rect.x).toBeGreaterThan(cardsRight);
    expect(inc!.rect.x + PORT_W).toBeLessThan(cardsLeft);
    expect(out!.rect.w).toBe(PORT_W);
    expect(out!.rect.h).toBe(PORT_H);
    expect(layout.bounds.x).toBeLessThanOrEqual(inc!.rect.x);
    expect(layout.bounds.x + layout.bounds.w).toBeGreaterThanOrEqual(out!.rect.x + PORT_W);
  });

  it("groups repeated cross-domain references into one port with all local links", () => {
    const extra = {
      ...input,
      edges: [...edges, edge("e8", "route-table", "r1", "t2")],
    };
    const layout = detailLayout(extra);
    const outPorts = layout.ports.filter((port) => port.direction === "out");
    expect(outPorts).toHaveLength(1);
    expect(outPorts[0]?.links).toEqual(["r1", "r2"]);
  });

  it("is deterministic: identical input gives identical positions, ports and edges", () => {
    const a = detailLayout(input);
    const b = detailLayout(input);
    expect([...a.positions.entries()]).toEqual([...b.positions.entries()]);
    expect(a.ports).toEqual(b.ports);
    expect(a.edges).toEqual(b.edges);
    const shuffled = detailLayout({
      ...input,
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
    });
    expect([...shuffled.positions.entries()]).toEqual([...a.positions.entries()]);
    expect(shuffled.ports).toEqual(a.ports);
    expect(shuffled.edges).toEqual(a.edges);
  });
});

describe("camera", () => {
  const bounds = { x: -100, y: -50, w: 400, h: 200 };

  it("fits inside the free viewport, reserving inset space", () => {
    const plain = fitCamera(bounds, 1000, 600);
    const reserved = fitCamera(bounds, 1000, 600, { insetRight: 320 });
    expect(reserved.scale).toBeLessThanOrEqual(plain.scale);
    // The content center lands in the middle of the FREE area, not under the drawer.
    const centerX = (bounds.x + bounds.w / 2) * reserved.scale + reserved.tx;
    expect(centerX).toBeCloseTo((1000 - 320) / 2, 5);
  });

  it("never shrinks below the readable floor", () => {
    const huge = { x: 0, y: 0, w: 20000, h: 20000 };
    const camera = fitCamera(huge, 800, 600);
    expect(camera.scale).toBe(SURFACE_MIN_FIT_SCALE);
  });

  it("handles empty bounds without dividing by zero", () => {
    const camera = fitCamera({ x: 0, y: 0, w: 0, h: 0 }, 800, 600);
    expect(Number.isFinite(camera.tx)).toBe(true);
    expect(camera.scale).toBe(1);
  });

  it("zoom keeps the world point under the cursor fixed", () => {
    const camera = { tx: 120, ty: 80, scale: 1 };
    const before = worldPoint(camera, 300, 200);
    const zoomed = zoomCamera(camera, 300, 200, 1.5);
    const after = worldPoint(zoomed, 300, 200);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(zoomed.scale).toBeCloseTo(1.5, 5);
  });
});
