// The contract marks' rendered contract (issue #69), as static markup (the ide/ pattern: no
// jsdom). The acceptance criterion under test: unknown facts are visually distinct from both
// "absent" and "ok" — hatched ring, own glyph and own label — and the compact LOD keeps glyph +
// count with the label in the title. Counter/filter semantics live in graph-contract.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Diagnostic } from "@facilis.dev/analyze";
import { initI18n, setLocale } from "@/i18n";
import type { RouteGraphData, TableGraphData, ViewGraphData } from "@/facilis/graph-types";
import {
  contractRingClass,
  RouteContractMarks,
  TableContractMarks,
  ViewContractMarks,
} from "./ProjectGraphContractMarks";

const NO_INPUT = { body: false, form: false, query: false, params: false };

function route(overrides: Partial<RouteGraphData> = {}): RouteGraphData {
  return {
    kind: "route",
    method: "GET",
    path: "/api/todos",
    permission: ["todos:read"],
    wrapper: "valid",
    description: null,
    input: { ...NO_INPUT, body: true },
    pathParams: [],
    dbTables: ["todos", "projects"],
    elevations: [],
    unknown: false,
    ...overrides,
  };
}

function table(overrides: Partial<TableGraphData> = {}): TableGraphData {
  return {
    kind: "table",
    table: "todos",
    columns: [],
    rlsEnabled: true,
    framework: false,
    scope: null,
    policies: [
      { name: "tenant_gate", restrictive: true },
      { name: "app_read", restrictive: false },
    ],
    unknown: false,
    ...overrides,
  };
}

function view(overrides: Partial<ViewGraphData> = {}): ViewGraphData {
  return {
    kind: "view",
    view: "active_todos",
    tables: ["todos"],
    permission: null,
    access: "invoker",
    unknown: false,
    usedByRoutes: [],
    ...overrides,
  };
}

const warning: Diagnostic = {
  code: "route-direct-db",
  severity: "warning",
  message: "direct db access",
  source: { file: "server/routes/todos.get.ts", line: 5 },
};
const error: Diagnostic = {
  code: "route-wrapper",
  severity: "error",
  message: "wrapper missing",
  source: null,
};

const routeMarks = (
  data: RouteGraphData,
  compact = false,
  secondary = false,
  diagnostics: readonly Diagnostic[] = [],
) =>
  renderToStaticMarkup(
    <RouteContractMarks
      route={data}
      diagnostics={diagnostics}
      compact={compact}
      secondary={secondary}
    />,
  );
const tableMarks = (data: TableGraphData, compact = false) =>
  renderToStaticMarkup(
    <TableContractMarks table={data} diagnostics={[]} compact={compact} secondary={false} />,
  );
const viewMarks = (data: ViewGraphData) =>
  renderToStaticMarkup(
    <ViewContractMarks view={data} diagnostics={[]} compact={false} secondary={false} />,
  );

/** The badge's opening tag: its state attributes (data-unknown, title, style) live there. */
function badgeTag(html: string, testId: string): string {
  const match = html.match(new RegExp('<span[^>]*data-testid="' + testId + '"[^>]*>'));
  return match?.[0] ?? "";
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("unknown vs absent vs ok (criterion 2)", () => {
  it("renders the input badge as three distinct states: present, absent, unknown", () => {
    const present = routeMarks(route());
    const absent = routeMarks(route({ input: NO_INPUT }));
    const unknown = routeMarks(route({ input: NO_INPUT, unknown: true }));

    expect(badgeTag(present, "contract-input")).not.toContain("data-unknown");
    expect(present).toContain(">input<");
    expect(badgeTag(absent, "contract-input")).not.toContain("data-unknown");
    expect(absent).toContain(">no input<");
    expect(badgeTag(unknown, "contract-input")).toContain('data-unknown="true"');
    expect(unknown).toContain(">input unknown<");

    // The unknown state is a hatched ring; the other two never hatch.
    expect(badgeTag(unknown, "contract-input")).toContain("repeating-linear-gradient");
    expect(badgeTag(unknown, "contract-input")).toContain("rounded-full");
    expect(badgeTag(present, "contract-input")).not.toContain("repeating-linear-gradient");
    expect(badgeTag(absent, "contract-input")).not.toContain("repeating-linear-gradient");
    // Pairwise distinct renderings: no state can read as another.
    expect(new Set([present, absent, unknown]).size).toBe(3);
  });

  it("never renders an unknown route's dbTables count as a fact", () => {
    const unknown = routeMarks(route({ unknown: true }));
    expect(badgeTag(unknown, "contract-tables")).toContain('data-unknown="true"');
    expect(unknown).toContain(">tables unknown<");
    expect(unknown).not.toContain(">2 tables<");
    const known = routeMarks(route());
    expect(known).toContain(">2 tables<");
    expect(badgeTag(known, "contract-tables")).not.toContain("data-unknown");
  });

  it("renders wrapper valid, invalid and unknown as three distinct badges", () => {
    const valid = routeMarks(route());
    const invalid = routeMarks(route({ wrapper: "invalid" }));
    const unknown = routeMarks(route({ wrapper: "unknown" }));
    expect(valid).toContain(">authorized<");
    expect(invalid).toContain(">invalid<");
    expect(badgeTag(unknown, "contract-wrapper")).toContain('data-unknown="true"');
    expect(badgeTag(unknown, "contract-wrapper")).toContain("repeating-linear-gradient");
    expect(valid).not.toContain(">unknown<");
  });

  it("renders table RLS on, system-only and unknown distinctly, with the policy count", () => {
    const on = tableMarks(table());
    const off = tableMarks(table({ rlsEnabled: false }));
    const unknown = tableMarks(table({ unknown: true }));
    expect(on).toContain(">RLS<");
    expect(on).toContain(">2 policies<");
    expect(off).toContain(">system-only<");
    expect(badgeTag(unknown, "contract-rls")).toContain('data-unknown="true"');
    expect(badgeTag(unknown, "contract-policies")).toContain('data-unknown="true"');
    expect(unknown).toContain(">RLS unknown<");
    expect(unknown).toContain(">policies unknown<");
    expect(unknown).not.toContain(">2 policies<");
  });

  it("renders view invoker, definer and unknown access distinctly", () => {
    const invoker = viewMarks(view());
    const definer = viewMarks(view({ access: "definer", permission: "reports:read" }));
    const unknown = viewMarks(view({ access: null, unknown: true }));
    expect(invoker).toContain(">invoker<");
    expect(invoker).toContain(">public<");
    expect(definer).toContain(">definer<");
    expect(definer).toContain(">reports:read<");
    expect(badgeTag(unknown, "contract-access")).toContain('data-unknown="true"');
    expect(badgeTag(unknown, "contract-permission")).toContain('data-unknown="true"');
    expect(unknown).toContain(">access unknown<");
    expect(unknown).toContain(">permission unknown<");
    expect(unknown).not.toContain(">public<");
  });
});

describe("compact LOD (criterion 1)", () => {
  it("drops the words but keeps glyph, count and the label in the title", () => {
    const full = routeMarks(route());
    const compact = routeMarks(route(), true);
    expect(full).toContain(">authorized<");
    expect(full).toContain(">2 tables<");
    expect(compact).not.toContain(">authorized<");
    expect(compact).not.toContain(">2 tables<");
    expect(compact).not.toContain(">input<");
    // The count survives as a bare number; the full label stays reachable on hover.
    expect(compact).toContain(">2</span>");
    expect(badgeTag(compact, "contract-wrapper")).toContain('title="authorized"');
    expect(badgeTag(compact, "contract-tables")).toContain('title="2 tables"');
    // Glyphs (svg) are still drawn in compact mode.
    expect(compact).toContain("<svg");
  });

  it("keeps the unknown hatch and label in compact mode", () => {
    const compact = routeMarks(route({ unknown: true }), true);
    expect(badgeTag(compact, "contract-input")).toContain('data-unknown="true"');
    expect(badgeTag(compact, "contract-input")).toContain("repeating-linear-gradient");
    expect(badgeTag(compact, "contract-input")).toContain('title="input unknown"');
  });
});

describe("lens role, elevations and diagnostics", () => {
  it("draws the secondary lens's marks at 30% opacity", () => {
    expect(routeMarks(route(), false, true)).toContain("opacity-30");
    expect(routeMarks(route(), false, false)).not.toContain("opacity-30");
  });

  it("shows the elevation lock with its count and the elevation names on hover", () => {
    const data = route({
      elevations: [
        {
          kind: "sudo",
          operation: "todos.purge",
          tables: ["todos"],
          source: { file: "r.ts", line: 1 },
          unknown: [],
        },
        {
          kind: "system",
          operation: null,
          tables: [],
          source: { file: "r.ts", line: 2 },
          unknown: [],
        },
      ],
    });
    const html = routeMarks(data);
    expect(badgeTag(html, "contract-elevations")).toContain(
      'title="Elevations: todos.purge, system"',
    );
    expect(html).toContain(">2 elevations<");
    expect(routeMarks(route())).not.toContain("contract-elevations");
  });

  it("attaches the diagnostics badge with count and messages, and rings the card by severity", () => {
    const html = routeMarks(route(), false, false, [warning, error]);
    const tag = badgeTag(html, "contract-diagnostics");
    expect(tag).toContain("direct db access");
    expect(tag).toContain("wrapper missing");
    expect(html).toContain(">2 diagnostics<");
    expect(routeMarks(route())).not.toContain("contract-diagnostics");
    expect(contractRingClass([warning, error])).toContain("outline-destructive");
    expect(contractRingClass([warning])).toContain("outline-warning");
    expect(contractRingClass([])).toBe("");
  });
});

describe("Italian locale", () => {
  it("speaks Italian for the contract states", () => {
    setLocale("it");
    const unknown = routeMarks(route({ unknown: true }));
    expect(unknown).toContain(">input sconosciuto<");
    expect(unknown).toContain(">tabelle sconosciute<");
    const absent = routeMarks(route({ input: NO_INPUT }));
    expect(absent).toContain(">senza input<");
    expect(tableMarks(table())).toContain(">2 policy<");
  });
});
