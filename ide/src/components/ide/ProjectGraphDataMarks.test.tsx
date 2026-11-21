// The data marks' rendered contract (issue #70), as static markup (the ide/ pattern: no jsdom).
// The acceptance criteria under test: scope/policy badges match the analyzed facts (criterion 2),
// unknown is visually distinct from both "absent" and "ok", the compact LOD keeps glyph+count
// with the label in the title, the secondary lens recedes to 30% (criterion 5), and the elevated
// lock glyph survives every LOD (criterion 1). Counter semantics live in graph-data-lens.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { TableGraphData, ViewGraphData } from "@/facilis/graph-types";
import { ElevatedEdgeLabel, TableDataMarks, ViewDataMarks } from "./ProjectGraphDataMarks";

function table(overrides: Partial<TableGraphData> = {}): TableGraphData {
  return {
    kind: "table",
    table: "todos",
    columns: [],
    rlsEnabled: true,
    framework: false,
    scope: { column: "tenantId", kind: "tenant" },
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

const tableMarks = (data: TableGraphData, compact = false, secondary = false) =>
  renderToStaticMarkup(<TableDataMarks table={data} compact={compact} secondary={secondary} />);
const viewMarks = (data: ViewGraphData, compact = false, secondary = false) =>
  renderToStaticMarkup(<ViewDataMarks view={data} compact={compact} secondary={secondary} />);
const lockLabel = (compact = false, secondary = false) =>
  renderToStaticMarkup(<ElevatedEdgeLabel x={10} y={20} compact={compact} secondary={secondary} />);

/** The badge's opening tag: its state attributes (data-unknown, data-state, title) live there. */
function badgeTag(html: string, testId: string): string {
  const match = html.match(new RegExp('<span[^>]*data-testid="' + testId + '"[^>]*>'));
  return match?.[0] ?? "";
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("table scope badge (criterion 2: matches the analyzed data)", () => {
  it("renders tenant, owner, none and unknown as four distinct states", () => {
    const tenant = tableMarks(table());
    const owner = tableMarks(table({ scope: { column: "ownerId", kind: "owner" } }));
    const none = tableMarks(table({ scope: null }));
    const unknown = tableMarks(table({ unknown: true, scope: null }));

    expect(badgeTag(tenant, "data-scope")).toContain('data-state="tenant"');
    expect(tenant).toContain(">tenant scope<");
    expect(badgeTag(owner, "data-scope")).toContain('data-state="owner"');
    expect(owner).toContain(">owner scope<");
    expect(badgeTag(none, "data-scope")).toContain('data-state="none"');
    expect(none).toContain(">no scope<");
    expect(badgeTag(unknown, "data-scope")).toContain('data-state="unknown"');
    expect(unknown).toContain(">scope unknown<");

    // Unknown is a hatched ring, distinct from the known pills in shape AND pattern.
    expect(badgeTag(unknown, "data-scope")).toContain('data-unknown="true"');
    expect(badgeTag(unknown, "data-scope")).toContain("rounded-full");
    expect(badgeTag(unknown, "data-scope")).toContain("repeating-linear-gradient");
    expect(badgeTag(none, "data-scope")).not.toContain("data-unknown");
    expect(badgeTag(none, "data-scope")).not.toContain("repeating-linear-gradient");
    // The four labels are pairwise distinct: no state reads as another.
    const labels = [tenant, owner, none, unknown].map(
      (html) => html.match(/data-testid="data-scope"[^>]*>.*?<span>([^<]*)<\/span>/)?.[1],
    );
    expect(new Set(labels).size).toBe(4);
  });

  it("names the scope column in the tooltip when the fact is readable", () => {
    expect(badgeTag(tableMarks(table()), "data-scope")).toContain("tenantId (tenant)");
  });

  it("counts every declared policy, restrictive gates included", () => {
    const html = tableMarks(table());
    expect(badgeTag(html, "data-policies")).not.toContain("data-unknown");
    expect(html).toContain(">2 policies<");
    const unreadable = tableMarks(table({ unknown: true }));
    expect(badgeTag(unreadable, "data-policies")).toContain('data-unknown="true"');
    expect(unreadable).toContain(">policies unknown<");
  });
});

describe("view access and permission badges", () => {
  it("renders invoker, definer and unknown access pairwise distinct", () => {
    const invoker = viewMarks(view());
    const definer = viewMarks(view({ access: "definer", permission: "todos:read" }));
    const unknown = viewMarks(view({ access: null }));
    expect(badgeTag(invoker, "data-access")).toContain('data-state="invoker"');
    expect(invoker).toContain(">invoker<");
    expect(badgeTag(definer, "data-access")).toContain('data-state="definer"');
    expect(definer).toContain(">definer<");
    expect(badgeTag(unknown, "data-access")).toContain('data-unknown="true"');
    expect(unknown).toContain(">access unknown<");
  });

  it("hatches the permission exactly when the access mode is unreadable (D-098)", () => {
    const unknown = viewMarks(view({ access: null }));
    expect(badgeTag(unknown, "data-permission")).toContain('data-unknown="true"');
    expect(unknown).toContain(">permission unknown<");
    const publicView = viewMarks(view());
    expect(badgeTag(publicView, "data-permission")).not.toContain("data-unknown");
    expect(publicView).toContain(">public<");
    const gated = viewMarks(view({ access: "definer", permission: "todos:read" }));
    expect(gated).toContain(">todos:read<");
    expect(badgeTag(gated, "data-permission")).toContain("Permission: todos:read");
  });
});

describe("compact LOD (epic rule 4) and secondary role (criterion 5)", () => {
  it("keeps glyph+count below the threshold, the full label in the title", () => {
    const html = tableMarks(table({ scope: null }), true);
    expect(html).toContain("<svg");
    expect(html).not.toContain(">no scope<");
    expect(html).not.toContain(">2 policies<");
    expect(html).toContain('class="tabular-nums">2</span>');
    expect(badgeTag(html, "data-scope")).toContain('title="no scope"');
    expect(badgeTag(html, "data-policies")).toContain('title="2 policies"');
  });

  it("recedes the marks row to 30% when the data lens is secondary", () => {
    expect(tableMarks(table(), false, true)).toContain("opacity-30");
    expect(tableMarks(table(), false, false)).not.toContain("opacity-30");
    expect(viewMarks(view(), false, true)).toContain("opacity-30");
    expect(lockLabel(false, true)).toContain('opacity="0.3"');
    expect(lockLabel(false, false)).toContain('opacity="1"');
  });
});

describe("elevated edge lock label (criterion 1: distinct at every LOD)", () => {
  it("draws the lock glyph at full and compact LOD alike", () => {
    for (const compact of [false, true]) {
      const html = lockLabel(compact);
      expect(html).toContain('data-testid="data-edge-lock"');
      // The lock is SVG geometry (rect + shackle path), not text: it survives every zoom.
      expect(html).toContain("<rect");
      expect(html).toContain("M7 11V7a5 5 0 0 1 10 0v4");
    }
  });

  it("names the elevation with text at full LOD and drops the word when compact", () => {
    expect(lockLabel(false)).toContain(">elevated<");
    expect(lockLabel(true)).not.toContain(">elevated<");
    // The meaning stays reachable in the title at every LOD.
    expect(lockLabel(true)).toContain("Elevated access (audited sudo/system)");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = tableMarks(table({ scope: null }));
    expect(html).toContain(">nessuno scope<");
    expect(lockLabel(false)).toContain(">elevato<");
  });
});
