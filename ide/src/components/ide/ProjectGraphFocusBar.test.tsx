// The focus bar's rendered contract (issue #66), as static markup (the ide/ pattern: no
// jsdom). The closure semantics live in graph-reachability/graph-user-focus tests; the browser
// gate proves the interaction. Here: the aria-live announcement, the isolate affordance and
// the dim-only isolate mode indicator (F.5: no breadcrumb, the full graph stays on screen).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { GraphClosureSummary } from "@/facilis/graph-user-focus";
import { ProjectGraphFocusBar } from "./ProjectGraphFocusBar";

const summary: GraphClosureSummary = {
  total: 12,
  pages: 3,
  routes: 2,
  tables: 2,
  views: 1,
  workflows: 0,
};

function markup(
  overrides: {
    summary?: GraphClosureSummary | null;
    isolated?: boolean;
    selectedNodeId?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <ProjectGraphFocusBar
      summary={overrides.summary === undefined ? summary : overrides.summary}
      isolated={overrides.isolated ?? false}
      selectedNodeId={overrides.selectedNodeId === undefined ? "a" : overrides.selectedNodeId}
      onIsolateChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphFocusBar", () => {
  it("renders nothing without a selection or an isolation", () => {
    expect(markup({ summary: null })).toBe("");
  });

  it("announces the closure size politely, matching the highlighted count", () => {
    const html = markup();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="graph-focus-summary"');
    expect(html).toContain("12 nodes reachable, 3 pages, 2 routes, 2 tables, 1 views");
  });

  it("omits zero-count kinds from the line", () => {
    const html = markup({
      summary: { total: 2, pages: 0, routes: 0, tables: 2, views: 0, workflows: 0 },
    });
    expect(html).toContain("2 nodes reachable, 2 tables");
    expect(html).not.toContain("pages");
    expect(html).not.toContain("workflows");
  });

  it("offers isolate as a named button", () => {
    const html = markup();
    const button = html.slice(html.indexOf('data-testid="graph-focus-isolate"'));
    expect(button.slice(0, button.indexOf("</button>"))).toContain('aria-label="Isolate"');
    expect(button).toContain("Isolate");
  });

  it("swaps isolate for the exit affordance while isolated, keeping the closure line", () => {
    const html = markup({ isolated: true });
    expect(html).toContain('data-testid="graph-focus-exit-isolate"');
    expect(html).toContain('aria-label="Exit isolation"');
    // Dim-only (F.5): the summary stays — no breadcrumb replaces it, nothing was removed.
    expect(html).toContain('data-testid="graph-focus-summary"');
    expect(html).not.toContain('data-testid="graph-focus-isolate"');
    expect(html).not.toContain("graph-focus-breadcrumb");
  });

  it("keeps the exit affordance when a stale isolate id has no closure left", () => {
    const html = markup({ summary: null, isolated: true });
    expect(html).toContain('data-testid="graph-focus-exit-isolate"');
    expect(html).not.toContain('data-testid="graph-focus-summary"');
  });

  it("names the group for assistive technology in both modes", () => {
    expect(markup()).toContain('aria-label="Selection context"');
    expect(markup({ isolated: true })).toContain('aria-label="Selection context"');
  });
});
