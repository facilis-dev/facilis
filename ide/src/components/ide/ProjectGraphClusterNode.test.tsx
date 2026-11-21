// @vitest-environment happy-dom
// The cluster node's LOD contract (issue #62, epic #56 rule 4): the collapsed super-node and
// the expanded frame keep their full content as the constant footprint sizer and render the
// counter-scaled chip/compact below full zoom, so no visible text drops under 7 px on screen.
// Dimming is the single-winner opacity ladder (user focus/drill 12%, search miss 40%).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { initI18n, setLocale } from "@/i18n";
import type { GraphLodLevel } from "@/facilis/graph-lod";
import type { GraphCluster } from "@/facilis/graph-types";
import {
  CLUSTER_NODE_TYPE,
  ClusterGraphNode,
  type ProjectClusterFlowNode,
} from "./ProjectGraphClusterNode";

let lodLevel: GraphLodLevel = "full";
vi.mock("./use-graph-lod", () => ({ useGraphLod: () => lodLevel }));

const CLUSTER: GraphCluster = {
  id: "cluster:api/todos",
  key: "api/todos",
  label: "api/todos",
  nodeIds: ["route:GET /api/todos", "page:src/pages/todos.tsx"],
  counts: { page: 1, route: 1, table: 0, view: 0, workflow: 0 },
  crossingEdges: 2,
  collapsible: true,
  collapsed: false,
  matched: true,
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
};

function markup(
  level: GraphLodLevel,
  overrides: Partial<GraphCluster> = {},
  focused = true,
): string {
  lodLevel = level;
  const cluster = { ...CLUSTER, ...overrides };
  const props = {
    id: cluster.id,
    type: CLUSTER_NODE_TYPE,
    data: { cluster, focused, onToggleCollapse: () => {} },
    selected: false,
  } as unknown as NodeProps<ProjectClusterFlowNode>;
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <ClusterGraphNode {...props} />
    </ReactFlowProvider>,
  );
}

/** The counter-scaled (constant screen size) font sizes the markup declares. */
function screenTextSizes(html: string): number[] {
  return [
    ...html.matchAll(/font-size:\s*calc\((\d+(?:\.\d+)?)px\/var\(--graph-lod-zoom,1\)\)/g),
  ].map((match) => Number(match[1]));
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("collapsed super-node LOD (issue #62)", () => {
  it("renders the full card with kind counts, crossing count and the collapse control", () => {
    const html = markup("full", { collapsed: true });
    expect(html).toContain('data-testid="project-graph-cluster-collapsed"');
    expect(html).toContain("api/todos");
    expect(html).toContain("2 nodes");
    expect(html).toContain("2 crossing edges");
    // A collapsed super-node offers expansion; the expanded frame offers collapse.
    expect(html).toContain('aria-label="Expand cluster"');
  });

  it("renders the chip at chip zoom with a >= 7 px screen text floor", () => {
    const html = markup("chip", { collapsed: true });
    expect(html).toContain('data-testid="project-graph-chip"');
    const sizes = screenTextSizes(html);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(7);
    // The full card stays in the DOM as the invisible footprint sizer (spatial constancy).
    expect(html).toContain("invisible");
  });

  it("renders the compact card at compact zoom", () => {
    const html = markup("compact", { collapsed: true });
    expect(html).toContain('data-testid="project-graph-compact"');
    for (const size of screenTextSizes(html)) expect(size).toBeGreaterThanOrEqual(7);
  });

  it("a non-collapsible lone other cluster has no collapse control and reads Other", () => {
    const html = markup("full", {
      collapsed: true,
      key: "other",
      label: "other",
      collapsible: false,
    });
    expect(html).toContain("Other");
    expect(html).not.toContain('aria-label="Collapse cluster"');
    expect(html).not.toContain('aria-label="Expand cluster"');
  });
});

describe("expanded frame LOD (issue #62)", () => {
  it("renders the labelled header with the kind chips and the crossing count", () => {
    const html = markup("full");
    expect(html).toContain('data-testid="project-graph-cluster"');
    expect(html).toContain("api/todos");
    expect(html).toContain("2 crossing edges");
    expect(html).toContain('aria-label="Feature cluster api/todos"');
    expect(html).toContain('aria-label="Collapse cluster"');
  });

  it("names the frame with a counter-scaled chip below full zoom", () => {
    for (const level of ["chip", "compact"] as const) {
      const html = markup(level);
      expect(html).toContain("api/todos");
      for (const size of screenTextSizes(html)) expect(size).toBeGreaterThanOrEqual(7);
      expect(html).toContain("invisible");
    }
  });
});

describe("cluster dimming is the single-winner opacity ladder", () => {
  it("dims outsiders of a drill to 12%, never stacking with a search miss", () => {
    expect(markup("full", { collapsed: true }, false)).toContain("opacity-12");
    expect(markup("full", {}, false)).toContain("opacity-12");
    expect(markup("full", { collapsed: true, matched: false }, false)).toContain("opacity-12");
  });

  it("dims a search miss to 40% when nothing else dims", () => {
    expect(markup("full", { collapsed: true, matched: false })).toContain("opacity-40");
    expect(markup("full", { matched: false })).toContain("opacity-40");
  });

  it("a bright matched cluster carries no dim", () => {
    for (const html of [markup("full", { collapsed: true }), markup("full")]) {
      expect(html).not.toContain("opacity-12");
      expect(html).not.toContain("opacity-40");
      expect(html).not.toContain("opacity-10");
    }
  });
});
