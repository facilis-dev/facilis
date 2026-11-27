// Static-markup tests for the search popup's ARIA wiring (issue #220): a named listbox, indexed
// option ids, and aria-selected/tabindex that follow the active option instead of a constant.
// The real focus move and the Escape handoff need a browser (pnpm ide:smoke).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-types.ts";
import { ProjectGraphSearchResults } from "./ProjectGraphSearchResults";

function page(id: string, label: string): ProjectGraphNode {
  return {
    id,
    kind: "page",
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page",
      pagePath: label,
      pageKind: "page",
      callCount: 0,
      routePaths: [],
      preview: null,
    },
  };
}

const results = [page("page:admin", "/admin"), page("page:users", "/users")];

function render(
  activeIndex: number,
  nodes: readonly ProjectGraphNode[] = results,
  query = "/",
): string {
  return renderToStaticMarkup(
    <ProjectGraphSearchResults
      id="graph-search"
      query={query}
      results={nodes}
      activeIndex={activeIndex}
      onJump={vi.fn()}
      onActiveChange={vi.fn()}
    />,
  );
}

function option(html: string, index: number): string {
  const pattern = new RegExp(`<button[^>]*id="graph-search-option-${index}"[^>]*>`);
  return html.match(pattern)?.[0] ?? "";
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphSearchResults", () => {
  it("renders one named listbox with indexed option ids", () => {
    const html = render(-1);
    expect(html).toContain('role="listbox"');
    expect(html).toContain('id="graph-search"');
    expect(html).toContain(`aria-label="${t("projectGraph.searchResults")}"`);
    expect(html).toContain('role="option"');
    expect(option(html, 0)).toContain('id="graph-search-option-0"');
    expect(option(html, 1)).toContain('id="graph-search-option-1"');
  });

  it("moves aria-selected and the single tab stop with the active option", () => {
    const idle = render(-1);
    expect(option(idle, 0)).toContain('aria-selected="false"');
    expect(option(idle, 0)).toContain('tabindex="0"');
    expect(option(idle, 1)).toContain('tabindex="-1"');

    const active = render(1);
    expect(option(active, 0)).toContain('aria-selected="false"');
    expect(option(active, 0)).toContain('tabindex="-1"');
    expect(option(active, 1)).toContain('aria-selected="true"');
    expect(option(active, 1)).toContain('tabindex="0"');
  });

  it("keeps one tab stop when the result set shrank under the active index", () => {
    const shrunk = render(5);
    expect(option(shrunk, 0)).toContain('aria-selected="false"');
    expect(option(shrunk, 0)).toContain('tabindex="0"');
    expect(option(shrunk, 1)).toContain('tabindex="-1"');
  });

  it("shows the no-matches message without options and disappears for a blank query", () => {
    const empty = render(-1, []);
    expect(empty).toContain(t("projectGraph.noMatches"));
    expect(empty).not.toContain('role="option"');
    expect(render(-1, results, "   ")).toBe("");
  });
});
