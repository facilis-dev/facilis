// The matrix's rendered contract (issue #67), as static markup (the ide/ pattern: no jsdom).
// The windowing criterion is asserted DIRECTLY — a 250-route grid must render a viewport-bounded
// number of DOM rows with spacers carrying the rest — which is deterministic, unlike a timing
// threshold. The click/key semantics live in the pure modules' tests; the browser gate proves
// the interaction. Here: the grid semantics, sticky headers, glyphs, degrees, strip and cursor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { buildGraphMatrix } from "@/facilis/graph-matrix";
import { buildProjectGraphView } from "@/facilis/graph-model";
import { reachabilityClosure } from "@/facilis/graph-reachability";
import { PAGE, TODOS, PROJECTS, ACTIVE_TODOS, graphOf, routeNode } from "@/facilis/graph-model.test-fixtures";
import { ProjectGraphMatrix } from "./ProjectGraphMatrix";
import { MATRIX_ROW_HEIGHT } from "./project-graph-matrix-window";

const GET = routeNode("GET", "/api/todos", { dbTables: ["todos", "projects", "active_todos"] });
const POST = routeNode("POST", "/api/todos", { dbTables: ["todos"] });
const graph = graphOf(
  [PAGE, GET, POST, TODOS, PROJECTS, ACTIVE_TODOS],
  [
    { id: "page-route:1", kind: "page-route", source: PAGE.id, target: GET.id, label: null },
    { id: "route-table:1", kind: "route-table", source: GET.id, target: TODOS.id, label: null },
    { id: "route-table:2", kind: "route-table", source: GET.id, target: PROJECTS.id, label: null, access: "elevated" },
    { id: "route-table:3", kind: "route-table", source: POST.id, target: TODOS.id, label: null },
    { id: "route-view:1", kind: "route-view", source: GET.id, target: ACTIVE_TODOS.id, label: null },
    { id: "view-base:1", kind: "view-base", source: ACTIVE_TODOS.id, target: TODOS.id, label: null },
  ],
);
const view = buildProjectGraphView({ graph });
const model = buildGraphMatrix(view);

function markup(overrides: { selectedNodeId?: string | null } = {}): string {
  return renderToStaticMarkup(
    <ProjectGraphMatrix
      model={model}
      sort="path"
      onSortChange={vi.fn()}
      selectedNodeId={overrides.selectedNodeId ?? null}
      onSelectNode={vi.fn()}
      onOpenEdge={vi.fn()}
      userFocus={null}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphMatrix", () => {
  it("renders a real table as a grid with announced coordinates and sticky headers", () => {
    const html = markup();
    expect(html).toContain("<table");
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="Route to table matrix"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("sticky top-0 left-0");
    expect(html).toContain('aria-activedescendant="graph-matrix-cell-0-0"');
    // The cell's aria-label names the route, the column and the kinds — not colour alone.
    expect(html).toContain("GET /api/todos × todos: Declared (dbTables), Via a view");
  });

  it("draws a distinct glyph per kind, stacked, plus the absent dot and a legend", () => {
    const html = markup();
    // Column 0 is projects (label order): GET declares it and elevates it — two stacked marks.
    const elevated = html.slice(html.indexOf('data-testid="graph-matrix-cell-0-0"'));
    expect(elevated.slice(0, elevated.indexOf("</td>"))).toContain('data-kinds="declared elevated"');
    const via = html.slice(html.indexOf('data-testid="graph-matrix-cell-0-1"'));
    expect(via.slice(0, via.indexOf("</td>"))).toContain('data-kinds="declared via-view"');
    expect(html).toContain("●");
    expect(html).toContain("▲");
    expect(html).toContain("◆");
    expect(html).toContain("·");
    expect(html).toContain("Declared (dbTables)");
    expect(html).toContain("Elevated access");
    expect(html).toContain("Via a view");
    expect(html).toContain("No access");
  });

  it("shows degree counts on both header axes and groups rows by method", () => {
    const html = markup();
    const todosCol = html.slice(html.indexOf('data-testid="graph-matrix-col-table:todos"'));
    expect(todosCol.slice(0, todosCol.indexOf("</th>"))).toContain(">2<");
    expect(html).toContain('data-testid="graph-matrix-group-GET"');
    expect(html).toContain('data-testid="graph-matrix-group-POST"');
    expect(html).toContain("Tables");
    expect(html).toContain("Views");
  });

  it("summarises pages as route counts in the strip and exposes the sort control", () => {
    const html = markup();
    expect(html).toContain('data-testid="graph-matrix-strip"');
    const page = html.slice(html.indexOf('data-testid="graph-matrix-page-' + PAGE.id + '"'));
    expect(page.slice(0, page.indexOf("</span>"))).toContain("1 routes");
    expect(html).toContain('data-testid="graph-matrix-sort-path"');
    const pressed = html.slice(html.indexOf('data-testid="graph-matrix-sort-path"'));
    expect(pressed.slice(0, pressed.indexOf("</button>"))).toContain('aria-pressed="true"');
  });

  it("keeps the selection across the mode switch and puts the cursor on its row", () => {
    const html = markup({ selectedNodeId: POST.id });
    const row = html.slice(html.indexOf('data-testid="graph-matrix-row-' + POST.id + '"'));
    expect(row.slice(0, row.indexOf("</tr>"))).toContain('aria-selected="true"');
    // POST is flat row 1 (GET group sorts /api/todos once): the cursor cell is row 1, col 0.
    expect(html).toContain('aria-activedescendant="graph-matrix-cell-1-0"');
    const cursor = html.slice(html.indexOf('data-testid="graph-matrix-cell-1-0"'));
    expect(cursor.slice(0, cursor.indexOf("</td>"))).toContain('aria-selected="true"');
  });

  it("dims search-unmatched rows and out-of-closure rows like the topology chrome", () => {
    const searched = buildGraphMatrix(buildProjectGraphView({ graph, query: "zzz-no-match" }));
    const html = renderToStaticMarkup(
      <ProjectGraphMatrix
        model={searched}
        sort="path"
        onSortChange={vi.fn()}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        onOpenEdge={vi.fn()}
        userFocus={null}
      />,
    );
    expect(html).toContain("opacity-40");
    // A closure that genuinely excludes a column: POST reaches todos only in this subgraph.
    const small = buildProjectGraphView({
      graph: graphOf(
        [POST, TODOS, PROJECTS],
        [{ id: "route-table:3", kind: "route-table", source: POST.id, target: TODOS.id, label: null }],
      ),
    });
    const closure = reachabilityClosure(small, POST.id);
    const focused = renderToStaticMarkup(
      <ProjectGraphMatrix
        model={buildGraphMatrix(small)}
        sort="path"
        onSortChange={vi.fn()}
        selectedNodeId={POST.id}
        onSelectNode={vi.fn()}
        onOpenEdge={vi.fn()}
        userFocus={closure}
      />,
    );
    expect(focused).toContain("opacity-12");
  });

  it("windows a 250-route grid: bounded DOM rows, spacers carry the rest (criterion 4)", () => {
    const routes = Array.from({ length: 250 }, (_, index) =>
      routeNode("GET", "/api/r" + String(index).padStart(3, "0")),
    );
    const big = buildGraphMatrix(
      buildProjectGraphView({
        graph: graphOf(
          [...routes, TODOS],
          routes.map((route, index) => ({
            id: "route-table:" + index,
            kind: "route-table" as const,
            source: route.id,
            target: TODOS.id,
            label: null,
          })),
        ),
      }),
    );
    const html = renderToStaticMarkup(
      <ProjectGraphMatrix
        model={big}
        sort="path"
        onSortChange={vi.fn()}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        onOpenEdge={vi.fn()}
        userFocus={null}
      />,
    );
    const renderedRows = html.split('data-testid="graph-matrix-row-').length - 1;
    // 640px default viewport / 32px pitch + overscan + one group header: far below 250.
    expect(renderedRows).toBeLessThanOrEqual(40);
    expect(renderedRows).toBeGreaterThan(0);
    expect(html).toContain('aria-rowcount="253"'); // 250 rows + 1 group + 2 header rows
    // The bottom spacer conserves the full scroll height for the unrendered rows.
    const items = 251;
    const end = Math.ceil(640 / MATRIX_ROW_HEIGHT) + 6;
    expect(html).toContain("height:" + (items - end) * MATRIX_ROW_HEIGHT + "px");
  });
});
