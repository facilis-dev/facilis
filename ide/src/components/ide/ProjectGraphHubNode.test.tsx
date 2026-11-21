// The hub chip markup (issue #64): a glyph plus the count (epic rule 4), a named button for
// keyboard users, and the hover satellite listing the route names on-canvas (epic rule 1).
// The count and the route list counter-scale through lodScreenPx so no text drops below the
// 7 px floor at any zoom. ide ships no jsdom for this suite: the presentational view is
// rendered to static markup, the established pattern of RecentProjectsRow.test.tsx.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { GraphEdgeHub } from "@/facilis/graph-edge-hubs";
import { HubChipView, type ProjectHubData } from "./ProjectGraphHubNode";

const hub: GraphEdgeHub = {
  id: "hub:route-table:table:tasks",
  kind: "route-table",
  target: "table:tasks",
  sources: Array.from({ length: 10 }, (_, index) => "route:GET /api/tasks/" + index),
  edges: [],
  count: 10,
  position: { x: 300, y: 200 },
  expanded: false,
};

function dataOf(overrides: Partial<ProjectHubData> = {}): ProjectHubData {
  return {
    hub,
    targetLabel: "tasks",
    routeLabels: hub.sources.map((id) => id.replace("route:", "")),
    hovered: false,
    focused: true,
    isolated: false,
    aiOutlined: false,
    onToggle: vi.fn(),
    onHover: vi.fn(),
    ...overrides,
  };
}

function markup(data: ProjectHubData): string {
  return renderToStaticMarkup(<HubChipView data={data} />);
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("HubChipView", () => {
  it("shows the count and is a named, keyboard-reachable button", () => {
    const html = markup(dataOf());
    expect(html).toContain('data-testid="project-graph-hub"');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(t("projectGraph.hub.aria", { count: 10, target: "tasks" }));
    expect(html).toContain(">10</span>");
    expect(html).toContain('aria-pressed="false"');
  });

  it("counter-scales the count and the route list above the 7 px floor (epic rule 4)", () => {
    const html = markup(dataOf({ hovered: true }));
    // The count is 10 screen px and the route list 10 screen px at every zoom.
    expect(html).toContain("calc(10px/var(--graph-lod-zoom,1))");
    expect(html).not.toMatch(/font-size:10px[^/]/u);
  });

  it("hover lists every route name in the on-canvas satellite", () => {
    const html = markup(dataOf({ hovered: true }));
    expect(html).toContain('data-testid="project-graph-hub-satellite"');
    expect(html).toContain(t("projectGraph.hub.routesTitle", { count: 10 }));
    for (const label of dataOf().routeLabels) expect(html).toContain(label);
    // No satellite without hover: the listing is transient, not a panel.
    expect(markup(dataOf())).not.toContain("project-graph-hub-satellite");
  });

  it("an expanded hub reads as pressed and offers re-concentration", () => {
    const html = markup(dataOf({ hub: { ...hub, expanded: true } }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(t("projectGraph.hub.hintExpanded"));
  });

  it("dims through the card channels: hover/user 12%, kind isolation 10%, never stacked", () => {
    expect(markup(dataOf({ focused: false }))).toContain("opacity-12");
    expect(markup(dataOf({ isolated: true }))).toContain("opacity-10");
    expect(markup(dataOf({ isolated: true, focused: false }))).not.toContain("opacity-12");
    expect(markup(dataOf())).not.toContain("opacity-12");
    expect(markup(dataOf())).not.toContain("opacity-10");
  });

  it("the AI focus outlines the chip instead of dimming it", () => {
    const html = markup(dataOf({ aiOutlined: true }));
    expect(html).toContain("outline-brand/70");
    expect(html).not.toContain("opacity-12");
  });

  it("uses role tokens only (D-044): no raw palette classes", () => {
    const html = markup(dataOf({ hovered: true }));
    expect(html).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|red|blue)-/u);
    expect(html).toContain("bg-card");
    expect(html).toContain("bg-popover");
  });
});
