// The bridged edge markup (issue #65, criterion 4): the path is focusable and announces its
// apex label; the arc renders as a quadratic with the label at the apex. Rendered to a static
// string inside a ReactFlowProvider (ide/ ships no jsdom — the RecentProjectsRow pattern).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import { initI18n, setLocale } from "@/i18n";
import type { BridgeSpec } from "@/facilis/graph-bridge-geometry";
import { ProjectGraphEdge, type ProjectFlowEdge } from "./ProjectGraphEdge";

const spec: BridgeSpec = {
  edgeId: "e",
  side: "above",
  source: { x: 246, y: 40 },
  target: { x: 1994, y: 40 },
  control: { x: 270, y: -136 },
  apex: { x: 695, y: -48 },
  radius: 48,
  label: "dbTables",
};

function markup(data: Partial<ProjectFlowEdge["data"]> = {}): string {
  const props = {
    id: "e",
    source: "s",
    target: "t",
    sourceX: 246,
    sourceY: 40,
    targetX: 1994,
    targetY: 40,
    selected: false,
    markerEnd: "url(#arrow)",
    type: "project-graph-edge",
    data: {
      kind: "route-table" as const,
      curve: null,
      onCurveChange: vi.fn(),
      bridge: spec,
      bridgeDimmed: false,
      onBridgeHover: vi.fn(),
      ...data,
    },
  };
  return renderToStaticMarkup(
    <ReactFlowProvider>
      <ProjectGraphEdge {...(props as Parameters<typeof ProjectGraphEdge>[0])} />
    </ReactFlowProvider>,
  );
}

describe("ProjectGraphEdge bridge rendering", () => {
  beforeEach(() => {
    initI18n();
    setLocale("en");
  });

  it("draws the quadratic arc and announces the apex label (criterion 4)", () => {
    const html = markup();
    expect(html).toContain(" Q ");
    expect(html).toContain('aria-label="Bridge: dbTables"');
    expect(html).toContain('role="img"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("dbTables</text>");
  });

  it("falls back to the analyzer-less kind name when the edge has no label", () => {
    const html = markup({ bridge: { ...spec, label: null } });
    expect(html).toContain('aria-label="Bridge: Route → table"');
    expect(html).toContain("Route → table</text>");
  });

  it("dims the path while another bridge is raised", () => {
    const html = markup({ bridgeDimmed: true });
    expect(html).toContain("opacity:0.25");
  });

  it("renders orthogonally once a curve is saved, dropping the bridge chrome", () => {
    const html = markup({ curve: { x: 10, y: -4 } });
    expect(html).not.toContain(" Q ");
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("dbTables</text>");
  });

  it("keeps non-bridge edges unfocusable and unannounced", () => {
    const html = markup({ bridge: null });
    expect(html).not.toContain('tabindex="0"');
    expect(html).not.toContain('role="img"');
  });
});
describe("ProjectGraphEdge data lens (issue #70)", () => {
  beforeEach(() => {
    initI18n();
    setLocale("en");
  });

  it("draws the dotted elevated stroke only under the lens", () => {
    const plain = markup({ access: "elevated", bridge: null });
    expect(plain).not.toContain("stroke-dasharray:1 3");
    const lens = markup({ access: "elevated", bridge: null, dataRole: "dominant" });
    expect(lens).toContain("stroke-dasharray:1 3");
    // The arrowhead keeps the base elevation colour, so stroke and marker agree.
    expect(lens).toContain("var(--warning)");
  });

  it("labels an elevated edge with the lock at every LOD and drops the word when compact", () => {
    const full = markup({ access: "elevated", bridge: null, dataRole: "dominant" });
    expect(full).toContain('data-testid="data-edge-lock"');
    expect(full).toContain(">elevated</text>");
    const compact = markup({
      access: "elevated",
      bridge: null,
      dataRole: "dominant",
      compactData: true,
    });
    expect(compact).toContain('data-testid="data-edge-lock"');
    expect(compact).not.toContain(">elevated</text>");
    // The meaning stays reachable at compact LOD through the title.
    expect(compact).toContain("Elevated access (audited sudo/system)");
  });

  it("fades the lock label to 30% when the data lens is secondary", () => {
    const secondary = markup({
      access: "elevated",
      bridge: null,
      dataRole: "secondary",
      compactData: false,
    });
    expect(secondary).toContain('opacity="0.3"');
    const dominant = markup({ access: "elevated", bridge: null, dataRole: "dominant" });
    expect(dominant).toContain('opacity="1"');
  });
});
