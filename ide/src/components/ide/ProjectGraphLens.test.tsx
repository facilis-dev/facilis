// Static-render tests for the lens overlay (issue #189): banner + legend + count + answer list,
// the explicit zero-match state (regression for #146), and the diagnosis callout re-translating
// on an en/it switch. ide/ ships no jsdom, so components render to strings like the other UI tests.

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import type { GraphLensAvailability } from "@/facilis/graph-surface/lens-lifecycle.ts";
import { LENS_AVAILABLE } from "@/facilis/graph-surface/lens-lifecycle.ts";
import { summarizeLens, type GraphLensId } from "@/facilis/graph-surface/lenses.ts";
import type { GraphLensState, GraphLensView } from "@/facilis/graph-surface/state-facts.ts";
import { ProjectGraphDiagnosisCallout } from "./ProjectGraphDiagnosisCallout";
import { ProjectGraphLensBar } from "./ProjectGraphLensBar";

const WRITE: GraphDiagnostic = {
  nodeId: "route:POST /api/todos",
  code: "publicWrite",
  params: { method: "POST" },
};
const ADMIN: GraphDiagnostic = {
  nodeId: "route:GET /api/admin/users",
  code: "publicAdmin",
  params: {},
};
const SHARED: GraphDiagnostic = {
  nodeId: "table:projects",
  code: "shared",
  params: { count: 2, domains: ["billing", "todos"] },
};
const NO_RLS: GraphDiagnostic = {
  nodeId: "table:todos",
  code: "tableNoRls",
  params: { table: "todos" },
};

const LABELS: Readonly<Record<string, string>> = {
  "route:POST /api/todos": "POST /api/todos",
  "route:GET /api/admin/users": "GET /api/admin/users",
  "table:projects": "projects",
  "table:todos": "todos",
};

function renderBar(
  lens: GraphLensId | null,
  diagnostics: readonly GraphDiagnostic[],
  availabilityOf: (lens: GraphLensId) => GraphLensAvailability = () => LENS_AVAILABLE,
  view?: GraphLensView,
): string {
  const resolved =
    view !== undefined
      ? view
      : lens === null
        ? null
        : { kind: "diagnostics" as const, summary: summarizeLens(lens, diagnostics) };
  return renderToStaticMarkup(
    <ProjectGraphLensBar
      lens={lens}
      view={resolved}
      nodeLabel={(id) => LABELS[id] ?? null}
      onSelectLens={vi.fn()}
      onClose={vi.fn()}
      onActivate={vi.fn()}
      drawerOpen={false}
      availabilityOf={availabilityOf}
    />,
  );
}

const RUNTIME_STATE: GraphLensState = {
  facts: [
    {
      nodeId: "route:GET /api/todos/{id}",
      code: "state.routeErrors",
      params: { errors: 2, total: 5, rate: 40 },
    },
  ],
  totals: { key: "projectGraph.surface.state.totals", count: 5, params: { errors: 2 } },
  params: { minutes: 5 },
  contextKey: "projectGraph.surface.state.window",
  emptyKey: null,
  emptyHintKey: null,
  badges: new Map(),
};

beforeEach(() => {
  initI18n();
  setLocale("en");
});
afterEach(() => setLocale("en"));

describe("ProjectGraphLensBar", () => {
  it("always offers the lens answers and no banner until one is active", () => {
    const html = renderBar(null, [WRITE]);
    expect(html).toContain("Q5 · Security");
    expect(html).toContain("Q4 · Elevated (sudo / system)");
    expect(html).toContain("Q9 · Shared across groups");
    expect(html).toContain("Q17 · Unknown");
    expect(html).not.toContain("project-graph-lens-banner");
  });

  it("shows the banner, legend, total count and answer list for an active lens", () => {
    const html = renderBar("security", [WRITE, ADMIN, NO_RLS, SHARED]);
    expect(html).toContain("project-graph-lens-banner");
    expect(html).toContain("Q5 · Security");
    expect(html).toContain("Flagged nodes: 3");
    expect(html).toContain("Exposed write route");
    expect(html).toContain("Table without RLS");
    expect(html).toContain("POST /api/todos");
    expect(html).toContain("anyone can call it");
    expect(html).toContain("project-graph-lens-answer-table:todos");
  });

  it("disables an unavailable lens and shows its reason instead of hiding it", () => {
    const html = renderBar(null, [WRITE], (lens) =>
      lens === "unknown"
        ? { available: false, reasonKey: "projectGraph.surface.state.notRunning" }
        : LENS_AVAILABLE,
    );
    const disabled = html.match(/<button[^>]*disabled[^>]*>/)?.[0] ?? "";
    expect(disabled).toContain("project-graph-lens-unknown");
    expect(disabled).toContain('data-unavailable="true"');
    expect(disabled).toContain("Project not running");
  });

  it("renders a state lens with its totals, window and translated facts", () => {
    const html = renderBar("runtime", [], () => LENS_AVAILABLE, {
      kind: "state",
      state: RUNTIME_STATE,
    });
    expect(html).toContain("5 requests · 2 errors");
    expect(html).toContain("Last 5 minutes");
    expect(html).toContain("2 of 5 requests failed with a 5xx (40%).");
    expect(html).toContain("Server errors");
    expect(html).toContain("project-graph-lens-answer-route:GET /api/todos/{id}");
  });

  it("explains an empty state lens instead of showing a blank panel", () => {
    const html = renderBar("runtime", [], () => LENS_AVAILABLE, {
      kind: "state",
      state: {
        ...RUNTIME_STATE,
        facts: [],
        totals: { key: "projectGraph.surface.state.totals", count: 0, params: { errors: 0 } },
        emptyKey: "projectGraph.surface.state.noTraffic",
      },
    });
    expect(html).toContain("project-graph-lens-empty");
    expect(html).toContain("No request reached any route in the last 5 minutes.");
  });

  it("explains a clean tree with the changes lens's own hint", () => {
    const html = renderBar("changes", [], () => LENS_AVAILABLE, {
      kind: "state",
      state: {
        ...RUNTIME_STATE,
        facts: [],
        totals: {
          key: "projectGraph.surface.state.changes.totals",
          count: 0,
          params: { modified: 0, added: 0, deleted: 0 },
        },
        params: { ref: "0123456" },
        contextKey: null,
        emptyKey: "projectGraph.surface.state.noChanges",
        emptyHintKey: "projectGraph.surface.state.changes.emptyHint",
      },
    });
    expect(html).toContain("The working tree matches the checkpoint.");
    expect(html).toContain("Edit a source file");
  });

  it("shows an explicit empty state when a lens matches nothing", () => {
    const html = renderBar("shared", [WRITE]);
    expect(html).toContain("project-graph-lens-empty");
    expect(html).toContain("Nothing matches this lens");
    expect(html).toContain("Close lens");
    expect(html).not.toContain("project-graph-lens-answer-");
  });

  it("re-translates the banner and the answer list on an en/it switch", () => {
    setLocale("it");
    const html = renderBar("security", [WRITE]);
    expect(html).toContain("Q5 · Sicurezza");
    expect(html).toContain("Nodi segnalati: 1");
    expect(html).toContain("Rotta di scrittura esposta");
    expect(html).toContain("chiunque può chiamarla");
  });
});

describe("ProjectGraphDiagnosisCallout", () => {
  it("renders every diagnostic for the selected node through t(code, params)", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphDiagnosisCallout diagnostics={[WRITE, ADMIN]} />,
    );
    expect(html).toContain("project-graph-diagnosis-callout");
    expect(html).toContain("Exposed write route");
    expect(html).toContain("writes (POST)");
    expect(html).toContain("Exposed admin route");
    expect(html).toContain("/admin");
  });

  it("re-translates without a reload when the locale changes", () => {
    setLocale("it");
    const html = renderToStaticMarkup(<ProjectGraphDiagnosisCallout diagnostics={[SHARED]} />);
    expect(html).toContain("Nodo condiviso");
    expect(html).toContain("Referenziato da 2 altri domini (billing, todos)");
  });

  it("renders the selected node's live facts through t(code, params)", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphDiagnosisCallout
        diagnostics={[]}
        lens="runtime"
        view={{ kind: "state", state: RUNTIME_STATE }}
        selectedNodeId="route:GET /api/todos/{id}"
      />,
    );
    expect(html).toContain("project-graph-state-callout");
    expect(html).toContain("Live signals");
    expect(html).toContain("Server errors");
    expect(html).toContain("2 of 5 requests failed with a 5xx (40%).");
  });

  it("renders nothing when the node has no diagnostic", () => {
    expect(renderToStaticMarkup(<ProjectGraphDiagnosisCallout diagnostics={[]} />)).toBe("");
  });
});
