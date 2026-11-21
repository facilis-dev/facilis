// @vitest-environment happy-dom
// The semantic zoom over a REAL React Flow canvas and a REAL React reconciler (issue #60,
// criteria 1-6): a simulated 0.2 -> 1.5 zoom gesture drives the store exactly as React Flow's
// zoom handler does (one transform update per frame), while render counters and a React
// Profiler prove the cards re-render only at the two level boundaries — never per frame.
// happy-dom is a test-only devDependency; the presentational layer stays on the static-markup
// pattern (ProjectGraphLod.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler, act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import type { GraphEdge } from "@facilis.dev/analyze";
import { initI18n, setLocale } from "@/i18n";
import { lodForZoom } from "@/facilis/graph-lod";
import { GRAPH_NODE_SIZES } from "@/facilis/graph-node-size";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { NodeDetails } from "@/facilis/graph-details";
import { buildProjectGraphView, type ProjectGraphView } from "@/facilis/graph-model";
import { GET, PAGE, TODOS, graphOf } from "@/facilis/graph-model.test-fixtures";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { useGraphLod } from "./use-graph-lod";

const counters = vi.hoisted(() => ({
  canvas: 0,
  cards: {} as Record<string, number>,
  probe: 0,
  profiler: 0,
  hook: 0,
}));

// Count the real card components without touching their behaviour: the wrapped types map is
// what the canvas registers, so every render below is a render of the production card.
vi.mock("./ProjectGraphNodes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectGraphNodes")>();
  // The route, view and workflow cards live in their own modules; the nodes module only
  // registers them.
  const { RouteGraphNode } = await import("./ProjectGraphRouteNode");
  const { ViewGraphNode } = await import("./ProjectGraphViewNode");
  const { WorkflowGraphNode } = await import("./ProjectGraphWorkflowNode");
  const { TableGraphNode } = await import("./ProjectGraphTableNode");
  type CardProps = Parameters<typeof actual.PageGraphNode>[0];
  const wrap = (name: string, Card: ComponentType<CardProps>): ComponentType<CardProps> => {
    const Counted = (props: CardProps) => {
      counters.cards[name] = (counters.cards[name] ?? 0) + 1;
      return <Card {...props} />;
    };
    return Counted;
  };
  const page = wrap("page", actual.PageGraphNode);
  const route = wrap("route", RouteGraphNode);
  const table = wrap("table", TableGraphNode);
  const view = wrap("view", ViewGraphNode);
  const workflow = wrap("workflow", WorkflowGraphNode);
  const { NOTE_NODE_TYPE } = await import("./ProjectGraphNote");
  return {
    ...actual,
    PageGraphNode: page,
    RouteGraphNode: route,
    TableGraphNode: table,
    ViewGraphNode: view,
    WorkflowGraphNode: workflow,
    PROJECT_GRAPH_NODE_TYPES: {
      page,
      route,
      table,
      view,
      workflow,
      [NOTE_NODE_TYPE]: actual.PROJECT_GRAPH_NODE_TYPES[NOTE_NODE_TYPE],
    },
  };
});

vi.mock("./ProjectGraphCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectGraphCanvas")>();
  const Counted = (props: Parameters<typeof actual.ProjectGraphCanvas>[0]) => {
    counters.canvas++;
    return <actual.ProjectGraphCanvas {...props} />;
  };
  return { ...actual, ProjectGraphCanvas: Counted };
});

// A hook-driven re-render re-runs the card itself, not its parent wrapper, so the per-card
// evidence counts useGraphLod invocations: every card, edge and the probe call it once per
// render. The wrapper counters above still prove React Flow never re-renders cards per frame.
vi.mock("./use-graph-lod", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-graph-lod")>();
  return {
    ...actual,
    useGraphLod: () => {
      counters.hook++;
      return actual.useGraphLod();
    },
  };
});

const storeHandle: { current: ReturnType<typeof useStoreApi> | null } = { current: null };

/** Subscribes exactly like a card does: the quantised level selector, nothing else. */
function LodProbe() {
  const level = useGraphLod();
  storeHandle.current = useStoreApi();
  counters.probe++;
  return <div data-testid="lod-probe" data-level={level} />;
}

const EDGES: GraphEdge[] = [
  { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
  { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: "dbTables" },
];

const view = buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS], EDGES) });

const NOOP = () => {};
const FIT_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

function canvasProps(nextView: ProjectGraphView, onSelectNode: (id: string | null) => void) {
  return {
    view: nextView,
    fitPadding: FIT_PADDING,
    onInstance: NOOP,
    notes: [],
    addNoteNonce: 0,
    // Concentration off: the LOD probe measures the cards alone, no hub artefacts (#64).
    concentration: "off" as const,
    viewport: { x: 0, y: 0, zoom: 0.2 },
    fitNonce: 0,
    edgeCurves: {},
    // Bridges off: the LOD probe measures the orthogonal geometry alone (issue #65).
    bridges: false,
    focus: null,
    userFocus: null,
    isolatedEdgeKinds: [],
    // The contract lens (issue #69) stays inert: no filters, no attached diagnostics.
    contract: { auditFilters: [], nodeDiagnostics: new Map() },
    // The data lens (issue #70) stays inert: no active lens, full LOD.
    data: { activeLenses: [], compactData: false },
    drill: null,
    selectedNodeId: null,
    onSelectNode,
    onMoveNode: NOOP,
    onToggleCollapse: NOOP,
    onToggleClusterCollapse: NOOP,
    onDrillCluster: NOOP,
    onOpenNode: NOOP,
    onViewportChange: NOOP,
    onEdgeCurveChange: NOOP,
    onCreateNote: NOOP,
    onMoveNote: NOOP,
    onEditNote: NOOP,
    onDeleteNote: NOOP,
    // The details satellite (issue #59) stays inert here: no details, pins or sheet, so the
    // render counts below measure the LOD alone.
    details: new Map<string, NodeDetails>(),
    sources: new Map<string, string>(),
    nodeLabel: () => null,
    sheetMode: false,
    sheetHeight: 0,
    containerWidth: 4000,
    pinned: [],
    dispatchPinned: NOOP,
    pinRequest: null,
    onOpenFileAt: NOOP,
    onOpenPreview: NOOP,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onSelectNode = vi.fn<(id: string | null) => void>();

function mount(nextView: ProjectGraphView = view) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      // A wide store viewport keeps every card inside onlyRenderVisibleElements at zoom 1.5.
      <ReactFlowProvider initialWidth={4000} initialHeight={2000}>
        <ProjectGraphCanvas {...canvasProps(nextView, onSelectNode)} />
        <Profiler
          id="lod-probe"
          onRender={() => {
            counters.profiler++;
          }}
        >
          <LodProbe />
        </Profiler>
      </ReactFlowProvider>,
    );
  });
}

function setZoom(zoom: number) {
  act(() => {
    storeHandle.current?.setState({ transform: [0, 0, zoom] });
  });
}

function card(kind: "page" | "route" | "table"): HTMLElement {
  const element = container?.querySelector('[data-testid="project-graph-' + kind + '"]');
  if (!(element instanceof HTMLElement)) throw new Error("card not rendered: " + kind);
  return element;
}

/** Effective px of every font size the subtree declares (arbitrary Tailwind px + inline calc). */
function effectiveTextSizes(element: Element, zoom: number): number[] {
  const sizes: number[] = [];
  for (const entry of [element, ...element.querySelectorAll("*")]) {
    const fontSize = (entry as HTMLElement).style?.fontSize ?? "";
    const calc = /calc\((\d+(?:\.\d+)?)px\/var\(--graph-lod-zoom,1\)\)/.exec(fontSize);
    if (calc !== null) sizes.push(Number(calc[1]));
    for (const match of (entry.getAttribute("class") ?? "").matchAll(
      /text-\[(\d+(?:\.\d+)?)px\]/g,
    )) {
      sizes.push(Number(match[1]) * zoom);
    }
  }
  return sizes;
}

/**
 * happy-dom has no layout engine: React Flow's ResizeObserver never fires and offsetWidth is 0,
 * so nodes would stay unmeasured and edges would not render. This shim gives the observer a
 * deterministic pulse and the node wrappers the SHARED full-card footprint sizes — the same
 * numbers the canvas and the AI scene use — so measurement behaves like a real browser.
 */
function installLayoutShim() {
  const sizeOf = (element: Element): { width: number; height: number } => {
    // The flow containers (the renderer div is what React Flow measures for its viewport):
    // a large viewport keeps every card inside onlyRenderVisibleElements across the sweep.
    if (
      element.classList.contains("react-flow") ||
      element.classList.contains("react-flow__renderer")
    ) {
      return { width: 4000, height: 2000 };
    }
    if (element.classList.contains("react-flow__handle")) return { width: 1, height: 1 };
    if (element.classList.contains("react-flow__node")) {
      const kind = (element.getAttribute("data-id") ?? "").split(":")[0] as GraphNodeKind;
      return GRAPH_NODE_SIZES[kind] ?? { width: 220, height: 48 };
    }
    return { width: 0, height: 0 };
  };
  class ShimResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      // Synchronous: React Flow observes inside a commit-effect, so the measurement lands in
      // the same act() flush (a microtask would only run after the synchronous test yields).
      this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ShimResizeObserver;
  for (const property of ["offsetWidth", "offsetHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return sizeOf(this)[property === "offsetWidth" ? "width" : "height"];
      },
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  installLayoutShim();
  initI18n();
  setLocale("en");
  counters.canvas = 0;
  counters.cards = {};
  counters.probe = 0;
  counters.profiler = 0;
  counters.hook = 0;
  onSelectNode.mockClear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  storeHandle.current = null;
});

describe("the 0.2 -> 1.5 zoom sweep (criterion 3)", () => {
  it("re-renders cards only at the two level boundaries, never per frame", () => {
    mount();
    const frames: number[] = [];
    for (let zoom = 0.2; zoom <= 1.5000001; zoom += 0.005) {
      frames.push(Math.round(zoom * 1000) / 1000);
    }
    const before = {
      canvas: counters.canvas,
      cards: { ...counters.cards },
      probe: counters.probe,
      profiler: counters.profiler,
      hook: counters.hook,
    };
    // Every data-lod element (3 cards + 2 edges) plus the probe subscribes to the level.
    const subscribers = (container?.querySelectorAll("[data-lod]").length ?? 0) + 1;
    const levels: string[] = [];
    for (const zoom of frames) {
      setZoom(zoom);
      const level = container
        ?.querySelector('[data-testid="lod-probe"]')
        ?.getAttribute("data-level");
      levels.push(level ?? "");
    }
    let levelChanges = 0;
    for (let index = 1; index < levels.length; index++) {
      if (levels[index] !== levels[index - 1]) levelChanges++;
    }
    // The evidence: 261 frames, 2 level changes, and exactly 2 extra renders per subscriber.
    expect(frames.length).toBe(261);
    expect(levelChanges).toBe(2);
    expect(levels[0]).toBe("chip");
    expect(levels[levels.length - 1]).toBe("full");
    expect(counters.probe - before.probe).toBe(2);
    expect(counters.profiler - before.profiler).toBe(2);
    expect(counters.canvas - before.canvas).toBe(0);
    // React Flow never re-rendered a card wrapper during the gesture...
    for (const kind of ["page", "route", "table"]) {
      expect((counters.cards[kind] ?? 0) - (before.cards[kind] ?? 0)).toBe(0);
    }
    // ...and each subscriber re-rendered exactly at the two boundaries: 2 x subscribers.
    expect(subscribers).toBe(6);
    expect(counters.hook - before.hook).toBe(2 * subscribers);
  });
});

describe("spatial constancy (criterion 2)", () => {
  it("never moves a node or an edge path when the level changes", () => {
    mount();
    const samples = [0.2, 0.6, 1.2];
    const paths: string[] = [];
    const transforms: string[] = [];
    for (const zoom of samples) {
      setZoom(zoom);
      const path = container?.querySelector(".react-flow__edge-path");
      paths.push(path?.getAttribute("d") ?? "");
      const node = container?.querySelector('.react-flow__node[data-id="' + PAGE.id + '"]');
      transforms.push((node as HTMLElement | null)?.style.transform ?? "");
      expect(card("page").getAttribute("data-lod")).toBe(lodForZoom(zoom));
    }
    expect(paths[0]).not.toBe("");
    expect(new Set(paths).size).toBe(1);
    expect(new Set(transforms).size).toBe(1);
  });

  it("keeps the full content as an invisible footprint sizer below full", () => {
    mount();
    setZoom(0.2);
    const sizer = card("page").firstElementChild;
    expect(sizer?.className).toContain("invisible");
    expect(sizer?.getAttribute("aria-hidden")).toBe("true");
    // The full card text is still in the DOM, occupying the full footprint.
    expect(sizer?.textContent).toContain(PAGE.label);
    expect(card("page").querySelector('[data-testid="project-graph-chip"]')).not.toBeNull();
    setZoom(1.2);
    expect(card("page").firstElementChild?.className).not.toContain("invisible");
    expect(card("page").querySelector('[data-testid="project-graph-chip"]')).toBeNull();
  });
});

describe("the text floor on the computed level (criterion 1)", () => {
  it("renders no text below 7 effective px at chip, compact or full", () => {
    mount();
    for (const zoom of [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9, 1.2, 1.5]) {
      setZoom(zoom);
      const level = lodForZoom(zoom);
      for (const kind of ["page", "route", "table"] as const) {
        const element = card(kind);
        expect(element.getAttribute("data-lod")).toBe(level);
        // Only the ACTIVE region is rendered text: below full the sizer is visibility:hidden.
        const active =
          level === "full"
            ? element.firstElementChild
            : element.querySelector(
                '[data-testid="project-graph-chip"], [data-testid="project-graph-compact"]',
              );
        expect(active).not.toBeNull();
        const sizes = effectiveTextSizes(active as Element, zoom);
        expect(sizes.length, `no text at zoom ${zoom} kind ${kind}`).toBeGreaterThan(0);
        for (const size of sizes)
          expect(size, `zoom ${zoom} kind ${kind}`).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe("chips stay interactive (criterion 4)", () => {
  it("keeps the node focusable and selects it through the chip", () => {
    mount();
    setZoom(0.2);
    const wrapper = container?.querySelector('.react-flow__node[data-id="' + PAGE.id + '"]');
    expect((wrapper as HTMLElement).tabIndex).toBe(0);
    const chip = card("page").querySelector('[data-testid="project-graph-chip"]');
    act(() => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSelectNode).toHaveBeenCalledWith(PAGE.id);
  });

  it("still dims a card the search excludes", () => {
    mount(buildProjectGraphView({ graph: graphOf([PAGE, GET, TODOS], EDGES), query: "pages" }));
    setZoom(0.2);
    expect(card("page").className).not.toContain("opacity-40");
    expect(card("table").className).toContain("opacity-40");
    expect(card("table").querySelector('[data-testid="project-graph-chip"]')).not.toBeNull();
  });
});

describe("edges at chip (criterion 5)", () => {
  it("thins the stroke and drops the bend handles, keeping the geometry", () => {
    mount();
    setZoom(0.6);
    const path = container?.querySelector(".react-flow__edge-path") as SVGPathElement;
    expect(path.style.strokeWidth).toBe("1.5");
    act(() => {
      path.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const edgeGroup = container?.querySelector(".react-flow__edge g[data-lod]");
    expect(edgeGroup?.querySelectorAll("circle").length).toBe(2);
    expect(edgeGroup?.querySelectorAll("text").length).toBe(0);
    const compactPath = path.getAttribute("d");
    setZoom(0.2);
    expect(path.style.strokeWidth).toBe("1");
    expect(edgeGroup?.querySelectorAll("circle").length).toBe(0);
    expect(edgeGroup?.querySelectorAll("text").length).toBe(0);
    expect(edgeGroup?.getAttribute("data-lod")).toBe("chip");
    expect(path.getAttribute("d")).toBe(compactPath);
  });
});

describe("the zoom CSS variable and reduced motion (criterion 6)", () => {
  it("writes the live zoom for the counter-scaled sizes without React re-renders", () => {
    mount();
    setZoom(0.321);
    const wrapper = container?.querySelector('[data-testid="project-graph-canvas"]') as HTMLElement;
    expect(wrapper.style.getPropertyValue("--graph-lod-zoom")).toBe("0.321");
    const overlay = card("page").querySelector(".absolute.inset-0");
    expect(overlay?.className).toContain("motion-safe:transition-opacity");
    expect(overlay?.className.replaceAll("motion-safe:transition-opacity", "")).not.toContain(
      "transition-opacity",
    );
  });
});
