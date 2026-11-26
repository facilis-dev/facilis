// Static-render tests for the lens overlay (issue #189): banner + legend + count + answer list,
// the explicit zero-match state (regression for #146), and the diagnosis callout re-translating
// on an en/it switch. ide/ ships no jsdom, so components render to strings like the other UI tests.

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import { summarizeLens, type GraphLensId } from "@/facilis/graph-surface/lenses.ts";
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

function renderBar(lens: GraphLensId | null, diagnostics: readonly GraphDiagnostic[]): string {
  return renderToStaticMarkup(
    <ProjectGraphLensBar
      lens={lens}
      summary={lens === null ? null : summarizeLens(lens, diagnostics)}
      nodeLabel={(id) => LABELS[id] ?? null}
      onSelectLens={vi.fn()}
      onClose={vi.fn()}
      onActivate={vi.fn()}
      drawerOpen={false}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});
afterEach(() => setLocale("en"));

describe("ProjectGraphLensBar", () => {
  it("always offers the four lens answers and no banner until one is active", () => {
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

  it("renders nothing when the node has no diagnostic", () => {
    expect(renderToStaticMarkup(<ProjectGraphDiagnosisCallout diagnostics={[]} />)).toBe("");
  });
});
