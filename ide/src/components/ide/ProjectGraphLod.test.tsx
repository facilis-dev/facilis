// The chip/compact content as static markup (the ide/ pattern: react-dom/server, no jsdom for
// the presentational layer). Asserts the issue #60 text floor on the COMPUTED level, the chip's
// kind + count, the hit area, and the reduced-motion-safe transition classes.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GraphEdge } from "@facilis.dev/analyze";
import { initI18n, setLocale, t, type MessageKey } from "@/i18n";
import { lodForZoom } from "@/facilis/graph-lod";
import { buildProjectGraphView } from "@/facilis/graph-model";
import {
  ACTIVE_TODOS,
  GET,
  PAGE,
  TODOS,
  WORKFLOW,
  graphOf,
  tableNode,
} from "@/facilis/graph-model.test-fixtures";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import { GraphLodOverlay, ProjectGraphLodContent, lodSizerClass } from "./ProjectGraphLod";

const EDGES: GraphEdge[] = [
  { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
  { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
  { id: "route-view:1", kind: "route-view", source: GET.id, target: ACTIVE_TODOS.id, label: null },
  { id: "view-base:1", kind: "view-base", source: ACTIVE_TODOS.id, target: TODOS.id, label: null },
  { id: "fk:self", kind: "fk", source: TODOS.id, target: TODOS.id, label: null },
];

const SYSTEM_ONLY = tableNode("audit_log", { rlsEnabled: false });

const view = buildProjectGraphView({
  graph: graphOf([PAGE, GET, TODOS, ACTIVE_TODOS, WORKFLOW, SYSTEM_ONLY], EDGES),
});

function nodeOf(id: string): ProjectGraphNode {
  const node = view.nodes.find((entry) => entry.id === id);
  if (node === undefined) throw new Error("fixture node missing: " + id);
  return node;
}

function edgeCountOf(id: string): number {
  return EDGES.filter((edge) => edge.source === id || edge.target === id).length;
}

/**
 * Every font size the markup declares, in effective (screen) px at the given zoom: an inline
 * calc over the zoom variable is a constant screen size; a fixed text-[Npx] class scales with
 * the zoom. This is the same arithmetic Tailwind/the browser applies.
 */
function effectiveTextSizes(markup: string, zoom: number): number[] {
  const sizes: number[] = [];
  for (const match of markup.matchAll(
    /font-size:\s*calc\((\d+(?:\.\d+)?)px\/var\(--graph-lod-zoom,1\)\)/g,
  )) {
    sizes.push(Number(match[1]));
  }
  for (const match of markup.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    sizes.push(Number(match[1]) * zoom);
  }
  return sizes;
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("the text floor on the computed level (criterion 1)", () => {
  const cases: { id: string; zooms: number[] }[] = [
    { id: PAGE.id, zooms: [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9] },
    { id: GET.id, zooms: [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9] },
    { id: TODOS.id, zooms: [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9] },
    { id: ACTIVE_TODOS.id, zooms: [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9] },
    { id: WORKFLOW.id, zooms: [0.05, 0.2, 0.44, 0.45, 0.6, 0.89, 0.9] },
  ];
  for (const { id, zooms } of cases) {
    it(`renders no text below 7 effective px for ${id}`, () => {
      const node = nodeOf(id);
      for (const zoom of zooms) {
        const level = lodForZoom(zoom);
        if (level === "full") continue; // the full card is asserted in the canvas test
        const markup = renderToStaticMarkup(
          <ProjectGraphLodContent node={node} edgeCount={edgeCountOf(id)} level={level} />,
        );
        const sizes = effectiveTextSizes(markup, zoom);
        expect(sizes.length).toBeGreaterThan(0);
        for (const size of sizes) {
          expect(size).toBeGreaterThanOrEqual(7);
        }
      }
    });
  }
});

describe("the chip (criterion 4)", () => {
  it("shows the kind word and the model-derived edge count for every kind", () => {
    for (const node of view.nodes) {
      const markup = renderToStaticMarkup(
        <ProjectGraphLodContent node={node} edgeCount={edgeCountOf(node.id)} level="chip" />,
      );
      expect(markup).toContain('data-testid="project-graph-chip"');
      expect(markup).toContain(t(("projectGraph.node." + node.kind) as MessageKey));
      const count = edgeCountOf(node.id);
      expect(markup).toContain(">" + String(count) + "</span>");
      expect(markup).toContain(t("projectGraph.lod.edgeCount", { count }));
      expect(markup).toContain(node.label);
    }
  });

  it("counts a self-loop once and an unconnected node zero", () => {
    expect(edgeCountOf(TODOS.id)).toBe(3);
    expect(edgeCountOf(WORKFLOW.id)).toBe(0);
    const markup = renderToStaticMarkup(
      <ProjectGraphLodContent node={nodeOf(WORKFLOW.id)} edgeCount={0} level="chip" />,
    );
    expect(markup).toContain(">0</span>");
  });

  it("is a 24-32 screen px box with a >= 24 screen px hit extender", () => {
    const markup = renderToStaticMarkup(
      <GraphLodOverlay>
        <ProjectGraphLodContent node={nodeOf(TODOS.id)} edgeCount={3} level="chip" />
      </GraphLodOverlay>,
    );
    expect(markup).toContain("height:calc(28px/var(--graph-lod-zoom,1))");
    expect(markup).toContain("min-width:calc(24px/var(--graph-lod-zoom,1))");
    expect(markup).toContain("min-height:calc(24px/var(--graph-lod-zoom,1))");
  });
});

describe("the compact badge row", () => {
  it("names the method, the RLS exception and the unknown state from facts", () => {
    const route = renderToStaticMarkup(
      <ProjectGraphLodContent node={nodeOf(GET.id)} edgeCount={3} level="compact" />,
    );
    expect(route).toContain('data-testid="project-graph-compact"');
    expect(route).toContain("GET");
    const systemOnly = renderToStaticMarkup(
      <ProjectGraphLodContent node={nodeOf(SYSTEM_ONLY.id)} edgeCount={0} level="compact" />,
    );
    expect(systemOnly).toContain(t("projectGraph.systemOnly"));
    const definer = renderToStaticMarkup(
      <ProjectGraphLodContent node={nodeOf(ACTIVE_TODOS.id)} edgeCount={2} level="compact" />,
    );
    expect(definer).toContain(t("projectGraph.access.definer"));
    const page = renderToStaticMarkup(
      <ProjectGraphLodContent node={nodeOf(PAGE.id)} edgeCount={1} level="compact" />,
    );
    expect(page).toContain(t("projectGraph.pageUnrouted"));
  });
});

describe("transitions and the footprint sizer (criteria 2 and 6)", () => {
  it("fades only under motion-safe, so prefers-reduced-motion disables it", () => {
    const overlay = renderToStaticMarkup(
      <GraphLodOverlay>
        <ProjectGraphLodContent node={nodeOf(TODOS.id)} edgeCount={3} level="chip" />
      </GraphLodOverlay>,
    );
    expect(overlay).toContain("motion-safe:transition-opacity");
    // No unconditional transition: strip the motion-safe ones and nothing may remain.
    expect(overlay.replaceAll("motion-safe:transition-opacity", "")).not.toContain(
      "transition-opacity",
    );
    expect(lodSizerClass("chip")).toContain("motion-safe:transition-opacity");
    expect(lodSizerClass("compact")).toContain("motion-safe:transition-opacity");
    expect(lodSizerClass("full").replaceAll("motion-safe:transition-opacity", "")).not.toContain(
      "transition-",
    );
  });

  it("keeps the full content in the DOM as an invisible sizer below full", () => {
    expect(lodSizerClass("chip")).toContain("invisible");
    expect(lodSizerClass("compact")).toContain("invisible");
    expect(lodSizerClass("full")).not.toContain("invisible");
  });
});
