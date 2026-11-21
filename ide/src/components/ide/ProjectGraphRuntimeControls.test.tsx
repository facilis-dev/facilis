// The runtime control strip's rendered contract (issue #72), as static markup (the ide/
// pattern: no jsdom). The window/live semantics ride the view state (graph-view-state.test.ts);
// the browser gate proves the interaction. Here: the toolbar, the pressed states, the names.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { RuntimeWindow } from "@/facilis/graph-runtime";
import { ProjectGraphRuntimeControls } from "./ProjectGraphRuntimeControls";

function markup(overrides: { window?: RuntimeWindow; live?: boolean } = {}): string {
  return renderToStaticMarkup(
    <ProjectGraphRuntimeControls
      window={overrides.window ?? "5m"}
      live={overrides.live ?? false}
      onWindowChange={vi.fn()}
      onLiveChange={vi.fn()}
    />,
  );
}

const button = (html: string, testId: string): string => {
  const start = html.indexOf('data-testid="' + testId + '"');
  expect(start, testId).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf("</button>", start));
};

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphRuntimeControls", () => {
  it("is a named toolbar with the three windows and the live toggle", () => {
    const html = markup();
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('data-testid="graph-runtime-controls"');
    expect(html).toContain("Runtime lens");
    for (const id of ["1m", "5m", "15m"]) {
      expect(html).toContain('data-testid="graph-runtime-window-' + id + '"');
    }
    expect(html).toContain('data-testid="graph-runtime-live"');
  });

  it("marks the selected window and the live state with aria-pressed", () => {
    const html = markup({ window: "15m", live: true });
    expect(button(html, "graph-runtime-window-1m")).toContain('aria-pressed="false"');
    expect(button(html, "graph-runtime-window-5m")).toContain('aria-pressed="false"');
    expect(button(html, "graph-runtime-window-15m")).toContain('aria-pressed="true"');
    expect(button(html, "graph-runtime-live")).toContain('aria-pressed="true"');
    expect(button(markup(), "graph-runtime-window-5m")).toContain('aria-pressed="true"');
    expect(button(markup(), "graph-runtime-live")).toContain('aria-pressed="false"');
  });

  it("names every button for keyboard and screen-reader users", () => {
    const html = markup();
    for (const id of [
      "graph-runtime-window-1m",
      "graph-runtime-window-5m",
      "graph-runtime-window-15m",
      "graph-runtime-live",
    ]) {
      expect(button(html, id)).toMatch(/aria-label="[^"]+"/);
    }
    expect(button(html, "graph-runtime-window-1m")).toContain("Show traffic for the last 1 min");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup({ live: true });
    expect(html).toContain("Lente runtime");
    expect(html).toContain("Mostra il traffico degli ultimi 5 min");
  });
});
