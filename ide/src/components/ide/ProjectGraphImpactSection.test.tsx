// The satellite impact section's rendered contract (issue #74), as static markup (the ide/
// pattern: no jsdom). Here: the toggle's pressed state, the semantic keyboard-reachable route
// list grouped by method, and the honest column-level unknown. The cascade itself is proved in
// graph-impact tests; the browser gate proves the interaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { RemovalImpact } from "@/facilis/graph-impact";
import type { ImpactSatellite } from "./useProjectGraphImpact";
import { ProjectGraphImpactSection } from "./ProjectGraphImpactSection";

const tableNode: ProjectGraphNode = {
  id: "table:todos",
  kind: "table",
  label: "todos",
  sourceFile: null,
  position: { x: 0, y: 0 },
  data: {
    kind: "table",
    table: "todos",
    columns: [
      { property: "id", name: "id", type: "uuid", markers: ["primaryKey"] },
      { property: "dueDate", name: "due_date", type: "timestamp", markers: [] },
    ],
    rlsEnabled: true,
    framework: false,
    scope: null,
    policies: [],
    unknown: false,
  },
  matched: true,
  collapsed: false,
};

const viewNode: ProjectGraphNode = {
  ...tableNode,
  id: "view:active_todos",
  kind: "view",
  label: "active_todos",
  data: {
    kind: "view",
    view: "active_todos",
    tables: ["todos"],
    permission: null,
    access: "invoker",
    unknown: false,
    usedByRoutes: [],
  },
};

const result: RemovalImpact = {
  targetId: "table:todos",
  affectedNodeIds: ["route:GET /api/todos", "route:POST /api/todos", "view:active_todos"],
  brokenEdgeIds: ["e1", "e2", "e3"],
  counts: { routes: 2, views: 1 },
};

const satellite = (overrides: Partial<ImpactSatellite> = {}): ImpactSatellite => ({
  active: false,
  result: null,
  columnImpact: null,
  columnAnalysed: false,
  impactColumn: null,
  routeGroups: [],
  onToggle: vi.fn(),
  onSimulateColumn: vi.fn(),
  ...overrides,
});

const activeGroups = [
  { method: "GET" as const, routes: [{ id: "route:GET /api/todos", label: "GET /api/todos" }] },
  { method: "POST" as const, routes: [{ id: "route:POST /api/todos", label: "POST /api/todos" }] },
];

const markup = (node: ProjectGraphNode, impact: ImpactSatellite): string =>
  renderToStaticMarkup(
    <ProjectGraphImpactSection
      node={node}
      impact={impact}
      nodeLabel={(id) => (id.startsWith("route:") ? id.slice(6) : null)}
      onSelectNode={vi.fn()}
    />,
  );

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphImpactSection", () => {
  it("offers the simulate toggle as a named, unpressed button while inactive", () => {
    const html = markup(tableNode, satellite());
    const button = html.slice(html.indexOf('data-testid="graph-impact-toggle"'));
    const start = button.slice(0, button.indexOf("</button>"));
    expect(start).toContain('aria-pressed="false"');
    expect(html).toContain("Simulate removal");
    // No cascade is drawn before the user asks for one.
    expect(html).not.toContain('data-testid="graph-impact-counts"');
  });

  it("lists affected routes grouped by method as semantic, keyboard-reachable lists", () => {
    const html = markup(tableNode, satellite({ active: true, result, routeGroups: activeGroups }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Stop simulation");
    expect(html).toContain("2 routes, 1 views");
    expect(html).toContain('aria-label="Affected routes"');
    expect(html).toContain('aria-label="GET routes"');
    expect(html).toContain('aria-label="POST routes"');
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    // Each route is a native button selecting its node, not a div with a click handler.
    const get = html.slice(html.indexOf('aria-label="GET routes"'));
    expect(get.slice(0, get.indexOf("</ul>"))).toContain("<button");
    expect(get).toContain("GET /api/todos");
  });

  it("says column-level impact is not analysed when the table has no column facts", () => {
    const html = markup(tableNode, satellite({ active: true, result, routeGroups: activeGroups }));
    expect(html).toContain("column-level impact is not analysed");
    // Columns stay keyboard-selectable: choosing one keeps the honest state visible.
    const column = html.slice(html.indexOf('data-testid="graph-impact-column"'));
    expect(column.slice(0, column.indexOf("</button>"))).toContain('aria-pressed="false"');
    expect(column).toContain("dueDate");
  });

  it("marks the simulated column pressed and hides the unknown once facts exist", () => {
    const html = markup(
      tableNode,
      satellite({
        active: true,
        result: {
          ...result,
          affectedNodeIds: ["route:GET /api/todos"],
          counts: { routes: 1, views: 0 },
        },
        routeGroups: [
          { method: "GET", routes: [{ id: "route:GET /api/todos", label: "GET /api/todos" }] },
        ],
        columnAnalysed: true,
        impactColumn: "dueDate",
        columnImpact: {
          analysed: true,
          targetId: "table:todos",
          columnProperty: "dueDate",
          affectedNodeIds: ["route:GET /api/todos"],
          brokenEdgeIds: ["e1"],
          counts: { routes: 1, views: 0 },
        },
      }),
    );
    expect(html).not.toContain("column-level impact is not analysed");
    const column = html.slice(html.indexOf("dueDate</button>") - 400);
    expect(column).toContain('aria-pressed="true"');
    expect(column).toContain("Stop simulating column dueDate");
  });

  it("shows the view's reading routes without a column affordance", () => {
    const html = markup(
      viewNode,
      satellite({
        active: true,
        result: { ...result, targetId: "view:active_todos", counts: { routes: 2, views: 0 } },
        routeGroups: activeGroups,
      }),
    );
    expect(html).toContain("2 routes, 0 views");
    expect(html).not.toContain("Column-level impact");
    expect(html).not.toContain('data-testid="graph-impact-column"');
  });

  it("renders nothing for kinds the lens cannot simulate", () => {
    const route: ProjectGraphNode = {
      ...tableNode,
      id: "route:GET /api/todos",
      kind: "route",
      data: {
        kind: "route",
        method: "GET",
        path: "/api/todos",
        permission: [],
        wrapper: "valid",
        description: null,
        input: { body: false, form: false, query: false, params: false },
        pathParams: [],
        dbTables: ["todos"],
        elevations: [],
        unknown: false,
      },
    };
    expect(markup(route, satellite())).toBe("");
  });
});
