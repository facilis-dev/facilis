// The palette's rendered contract (issue #68), as static markup (the ide/ pattern: no jsdom).
// The ranking/perf contract lives in graph-palette.test.ts and the key guard in
// graph-keys.test.ts; the browser gate proves the live interaction. Here: dialog/listbox/option
// semantics, the kind groups with badges, exact-label-first order and accessible names.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { buildProjectGraphView } from "@/facilis/graph-model";
import {
  graphOf,
  pageNode,
  routeNode,
  tableNode,
  viewNode,
} from "@/facilis/graph-model.test-fixtures";
import { buildPaletteIndex } from "@/facilis/graph-palette";
import { ProjectGraphPalette } from "./ProjectGraphPalette";

const index = buildPaletteIndex(
  buildProjectGraphView({
    graph: graphOf([
      pageNode("src/pages/todos.tsx"),
      routeNode("GET", "/api/todos"),
      tableNode("todos"),
      viewNode("active_todos"),
    ]),
  }).nodes,
);

function markup(open = true): string {
  return renderToStaticMarkup(
    <ProjectGraphPalette
      open={open}
      index={index}
      onClose={vi.fn()}
      onZoomToNode={vi.fn()}
      onRunCommand={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphPalette", () => {
  it("renders nothing while closed", () => {
    expect(markup(false)).toBe("");
  });

  it("is a named modal dialog with a combobox search and a listbox", () => {
    const html = markup();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Graph command palette");
    expect(html).toContain('data-testid="graph-palette-input"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-controls="graph-palette-listbox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
  });

  it("groups by kind with the commands first and a badge icon per node option", () => {
    const html = markup();
    expect(html).toContain('data-testid="graph-palette-group-command"');
    for (const kind of ["page", "route", "table", "view"]) {
      expect(html).toContain('data-testid="graph-palette-group-' + kind + '"');
    }
    expect(html).toContain("Commands");
    expect(html).toContain("Tables");
    // Every node option carries its kind as data and an accessible name naming the kind.
    expect(html).toContain('data-kind="table"');
    expect(html).toContain("todos (Tables)");
  });

  it("lists every command with its accessible name", () => {
    const html = markup();
    expect(html).toContain("Fit to view");
    expect(html).toContain("Reset layout");
    expect(html).toContain("Toggle matrix mode");
    expect(html).toContain("Save layout");
    expect(html).toContain("Isolate edge kind: Route → table");
    expect(html).toContain("Isolate edge kind: Foreign key");
  });

  it("marks exactly one option selected for the arrow-key cursor", () => {
    const html = markup();
    const selected = html.match(/aria-selected="true"/g) ?? [];
    expect(selected.length).toBe(1);
    expect(html).toContain('aria-activedescendant="graph-palette-option-0"');
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup();
    expect(html).toContain("Palette comandi del grafo");
    expect(html).toContain("Comandi");
    expect(html).toContain("Isola il tipo di arco: Route → tabella");
  });
});
