// The impact bar's rendered contract (issue #74), as static markup (the ide/ pattern: no
// jsdom). The cascade semantics live in graph-impact tests; the browser gate proves the
// interaction. Here: the aria-live counts, the hint, the honest unknown and the exit affordance.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { ImpactHud } from "./useProjectGraphImpact";
import { ProjectGraphImpactBar } from "./ProjectGraphImpactBar";

const hud = (overrides: Partial<ImpactHud> = {}): ImpactHud => ({
  active: true,
  counts: { routes: 7, views: 2 },
  hint: false,
  columnNotAnalysed: false,
  ...overrides,
});

const markup = (next: ImpactHud): string =>
  renderToStaticMarkup(<ProjectGraphImpactBar hud={next} onExit={vi.fn()} />);

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphImpactBar", () => {
  it("renders nothing while the lens is inactive", () => {
    expect(markup(hud({ active: false }))).toBe("");
  });

  it("announces the counts politely, derived from the same cascade the canvas draws", () => {
    const html = markup(hud());
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("7 routes, 2 views");
    expect(html).toContain('aria-label="Impact simulation"');
  });

  it("shows the selection hint instead of counts when nothing suitable is selected", () => {
    const html = markup(hud({ counts: null, hint: true }));
    expect(html).toContain("Select a table to simulate its removal");
    expect(html).not.toContain("routes,");
  });

  it("says column-level impact is not analysed when the column has no facts", () => {
    const html = markup(hud({ counts: null, columnNotAnalysed: true }));
    expect(html).toContain("column-level impact is not analysed");
  });

  it("offers a named exit button that restores the previous view", () => {
    const html = markup(hud());
    const button = html.slice(html.indexOf('data-testid="graph-impact-exit"'));
    expect(button.slice(0, button.indexOf("</button>"))).toContain(
      'aria-label="Exit impact simulation"',
    );
  });
});
