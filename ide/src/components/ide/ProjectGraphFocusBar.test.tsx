// The focus bar's rendered contract (issue #66), as static markup (the ide/ pattern: no
// jsdom). The closure semantics live in graph-reachability/graph-user-focus tests; the browser
// gate proves the interaction. Here: the aria-live announcement, the isolate affordance and
// the isolate breadcrumb.
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
    isolatedLabel?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <ProjectGraphFocusBar
      summary={overrides.summary === undefined ? summary : overrides.summary}
      isolatedLabel={overrides.isolatedLabel ?? null}
      onIsolate={vi.fn()}
      onExitIsolate={vi.fn()}
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

  it("becomes a breadcrumb with an exit affordance while isolated", () => {
    const html = markup({ isolatedLabel: "todos" });
    expect(html).toContain('data-testid="graph-focus-breadcrumb"');
    expect(html).toContain("todos");
    expect(html).toContain('data-testid="graph-focus-exit-isolate"');
    expect(html).toContain('aria-label="Exit isolation"');
    // The closure line is replaced by the breadcrumb, not stacked under it.
    expect(html).not.toContain('data-testid="graph-focus-summary"');
    expect(html).not.toContain('data-testid="graph-focus-isolate"');
  });

  it("names the group for assistive technology in both modes", () => {
    expect(markup()).toContain('aria-label="Selection context"');
    expect(markup({ isolatedLabel: "todos" })).toContain('aria-label="Selection context"');
  });
});
