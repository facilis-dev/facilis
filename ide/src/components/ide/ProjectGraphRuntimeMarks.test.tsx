// The runtime marks' rendered contract (issue #72), as static markup (the ide/ pattern: no
// jsdom). The render-count acceptance lives at the store seam the component binds: the last
// describe drives the EXACT routeSource pair through useSyncExternalStore's contract, because
// a notification re-renders a subscriber only when getSnapshot's identity changed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { initI18n, setLocale } from "@/i18n";
import { getRuntimeLensStore, heatOf, type RuntimeWindow } from "@/facilis/graph-runtime";
import type { ProjectGraphNode, RouteGraphData } from "@/facilis/graph-types";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";
import { RouteGraphNode } from "./ProjectGraphRouteNode";
import {
  RouteRuntimeMarks,
  RuntimeLensContext,
  heatDotClass,
  type RuntimeLensContextValue,
} from "./ProjectGraphRuntimeMarks";

const T0 = 1_700_000_000_000;
const A = "/api/todos";
const B = "/api/other";

const route: RouteGraphData = {
  kind: "route",
  method: "GET",
  path: A,
  permission: [],
  wrapper: "valid",
  description: null,
  input: { body: false, form: false, query: false, params: false },
  pathParams: [],
  dbTables: [],
  elevations: [],
  unknown: false,
};
const node: ProjectGraphNode = {
  id: "route:GET " + A,
  kind: "route",
  label: "GET " + A,
  sourceFile: null,
  position: { x: 0, y: 0 },
  data: route,
  matched: true,
  collapsed: false,
};
const props = {
  data: { node, collapsed: false, focused: true, isolated: false, onToggleCollapse: vi.fn() },
  selected: false,
  dragging: false,
} as unknown as NodeProps<ProjectAnalysisFlowNode>;

const lens = (overrides: Partial<RuntimeLensContextValue> = {}): RuntimeLensContextValue => ({
  window: "5m",
  detailed: true,
  secondary: false,
  ...overrides,
});

function cardMarkup(value: RuntimeLensContextValue | null): string {
  // The card's link handles need the React Flow store, exactly as on the canvas.
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <RuntimeLensContext.Provider value={value}>
        <RouteGraphNode {...props} />
      </RuntimeLensContext.Provider>
    </ReactFlowProvider>,
  );
}

function marksMarkup(value: RuntimeLensContextValue): string {
  return renderToStaticMarkup(<RouteRuntimeMarks route={route} lens={value} />);
}

const store = getRuntimeLensStore();
const ingest = (count: number, status = 200, at = T0, target = A) => {
  store.ingest(
    Array.from({ length: count }, () => ({ route: target, method: "GET", status, duration: 12 })),
    at,
  );
};

beforeEach(() => {
  initI18n();
  setLocale("en");
  store.dispose();
  store.enable([A, B]);
});

describe("lens off (acceptance criterion 1)", () => {
  it("renders the card exactly as before: no marks, no subscription, no data dependency", () => {
    const before = cardMarkup(null);
    expect(before).not.toContain("runtime-marks-route");
    expect(before).not.toContain("runtime-heat-dot");
    // Traffic arriving while the lens is off changes nothing the card renders.
    ingest(50);
    expect(cardMarkup(null)).toBe(before);
    // The default context (no lens provider at all) is the same stable null.
    expect(
      renderToStaticMarkup(
        <ReactFlowProvider>
          <RouteGraphNode {...props} />
        </ReactFlowProvider>,
      ),
    ).toBe(before);
    expect(store.subscriberCount(A)).toBe(0);
  });
});

describe("heat and error marks", () => {
  it("no traffic draws no dot and never a green/healthy mark (criterion 4)", () => {
    const html = cardMarkup(lens());
    expect(html).not.toContain("runtime-marks-route");
    expect(html).not.toContain("bg-success");
    expect(html).not.toContain("text-success");
  });

  it("healthy traffic draws the heat dot but no error dot", () => {
    ingest(3);
    const html = marksMarkup(lens());
    expect(html).toContain('data-testid="runtime-heat-dot"');
    expect(html).toContain("bg-info/25"); // 3 requests -> level 1
    expect(html).not.toContain('data-testid="runtime-error-dot"');
    expect(html).not.toContain("bg-success");
  });

  it("quantises the heat dot to five intensity steps on the info role token", () => {
    const steps: [number, string][] = [
      [1, "bg-info/25"],
      [5, "bg-info/45"],
      [25, "bg-info/65"],
      [100, "bg-info/85"],
      [500, "bg-info"],
    ];
    for (const [count, className] of steps) {
      store.dispose();
      store.enable([A]);
      ingest(count);
      const html = marksMarkup(lens());
      expect(html, String(count)).toContain(className);
      expect(heatDotClass(heatOf(count))).toBe(className);
    }
  });

  it("a 5xx response adds the destructive error dot; a 4xx does not (criterion 4)", () => {
    ingest(2, 503);
    const errored = marksMarkup(lens());
    expect(errored).toContain('data-testid="runtime-error-dot"');
    expect(errored).toContain("bg-destructive");
    store.dispose();
    store.enable([A]);
    ingest(2, 401);
    const clientErrored = marksMarkup(lens());
    expect(clientErrored).not.toContain('data-testid="runtime-error-dot"');
    expect(clientErrored).toContain('data-testid="runtime-heat-dot"');
  });

  it("adds to the card's own badges, never replaces them", () => {
    ingest(4);
    const html = cardMarkup(lens());
    expect(html).toContain('data-testid="project-graph-route"');
    expect(html).toContain("GET"); // the method badge survives
    expect(html).toContain(A); // the path survives
    expect(html).toContain('data-testid="runtime-marks-route"');
  });
});

describe("LOD and lens role", () => {
  it("chip LOD draws the corner dot only; detailed adds the count (criterion 3)", () => {
    ingest(7);
    const chip = marksMarkup(lens({ detailed: false }));
    expect(chip).toContain('data-testid="runtime-heat-dot"');
    expect(chip).not.toContain('data-testid="runtime-count"');
    const detailed = marksMarkup(lens({ detailed: true }));
    expect(detailed).toContain('data-testid="runtime-count"');
    expect(detailed).toContain(">7<");
  });

  it("the error dot survives the chip LOD", () => {
    ingest(7, 500);
    const chip = marksMarkup(lens({ detailed: false }));
    expect(chip).toContain('data-testid="runtime-error-dot"');
  });

  it("a secondary lens recedes to 30% (epic rule 3)", () => {
    ingest(2);
    expect(marksMarkup(lens({ secondary: true }))).toContain("opacity-30");
    expect(marksMarkup(lens({ secondary: false }))).not.toContain("opacity-30");
  });

  it("names the window in the dot's label and speaks Italian", () => {
    ingest(2);
    expect(marksMarkup(lens())).toContain("2 requests in the last 5 min");
    setLocale("it");
    expect(marksMarkup(lens())).toContain("2 richieste negli ultimi 5 min");
  });
});

// useSyncExternalStore's external-update contract: a notification re-renders the subscriber
// only when getSnapshot's identity changed. This runner is that contract, verbatim.
function bind(template: string, window: RuntimeWindow) {
  const source = store.routeSource(template, window);
  let renders = 1;
  let snapshot = source.getSnapshot();
  const unsubscribe = source.subscribe(() => {
    const next = source.getSnapshot();
    if (next !== snapshot) {
      snapshot = next;
      renders += 1;
    }
  });
  return { renders: () => renders, unsubscribe };
}

describe("render granularity through the component's store seam (criterion 5)", () => {
  it("a batch touching route A does not re-render route B's card", () => {
    store.setLive(true, T0);
    const cardA = bind(A, "5m");
    const cardB = bind(B, "5m");
    ingest(3, 200, T0 + 1_000, A);
    expect(cardA.renders()).toBe(2);
    expect(cardB.renders()).toBe(1);
    store.tick(T0 + 2_000); // no expiry, no new traffic
    expect(cardA.renders()).toBe(2);
    expect(cardB.renders()).toBe(1);
    cardA.unsubscribe();
    cardB.unsubscribe();
    expect(store.subscriberCount(A)).toBe(0);
    expect(store.subscriberCount(B)).toBe(0);
  });
});
