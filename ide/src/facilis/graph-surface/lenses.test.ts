// The code -> i18n -> lens contract (D-220, #189). These are the invariants the canvas and the
// answer list rely on: one mapping, no prose, no colour literals, and draw-only state that never
// touches the layout fingerprint (nodes never move under a lens).

import type { GraphDiagnostic } from "@facilis.dev/analyze";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphView } from "@/facilis/graph-model";
import { surfaceLayoutKey } from "@/facilis/graph-surface/positions.ts";
import {
  DIAGNOSTIC_COLOR_TOKENS,
  DIAGNOSTIC_LABEL_KEYS,
  DIAGNOSTIC_MESSAGE_KEYS,
  GRAPH_LENSES,
  GRAPH_LENS_SOURCES,
  LENS_BY_CODE,
  diagnosticParams,
  diagnosticsByNode,
  domainFlagCounts,
  isStateCode,
  lensForCode,
  lensHighlight,
  summarizeLens,
  type GraphLensCode,
} from "./lenses.ts";

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
const NO_RLS: GraphDiagnostic = {
  nodeId: "table:todos",
  code: "tableNoRls",
  params: { table: "todos" },
};
const ELEVATED: GraphDiagnostic = {
  nodeId: "route:GET /api/system/users",
  code: "elevated",
  params: {},
};
const SHARED: GraphDiagnostic = {
  nodeId: "table:projects",
  code: "shared",
  params: { count: 2, domains: ["billing", "todos"] },
};
const UNKNOWN: GraphDiagnostic = {
  nodeId: "route:PATCH /api/todos/{id}",
  code: "unknown",
  params: {},
};
const ALL = [WRITE, ADMIN, NO_RLS, ELEVATED, SHARED, UNKNOWN];

beforeEach(() => {
  initI18n();
  setLocale("en");
});
afterEach(() => setLocale("en"));

describe("lens contract", () => {
  it("maps every analyzer code to exactly one lens", () => {
    expect(LENS_BY_CODE).toEqual({
      publicWrite: "security",
      publicAdmin: "security",
      tableNoRls: "security",
      elevated: "elevated",
      shared: "shared",
      unknown: "unknown",
    });
    for (const code of Object.keys(LENS_BY_CODE)) {
      expect(DIAGNOSTIC_MESSAGE_KEYS[code as keyof typeof DIAGNOSTIC_MESSAGE_KEYS]).toContain(
        "projectGraph.surface.diag.",
      );
      expect(DIAGNOSTIC_LABEL_KEYS[code as keyof typeof DIAGNOSTIC_LABEL_KEYS]).toContain(
        "projectGraph.surface.diag.",
      );
      expect(DIAGNOSTIC_COLOR_TOKENS[code as keyof typeof DIAGNOSTIC_COLOR_TOKENS]).toMatch(
        /^--[a-z-]+$/,
      );
    }
  });

  it("exposes the four lens definitions with their codes and legend", () => {
    expect(GRAPH_LENSES.map((entry) => entry.id)).toEqual([
      "security",
      "elevated",
      "shared",
      "unknown",
    ]);
    expect(GRAPH_LENSES[0].codes).toEqual(["publicWrite", "publicAdmin", "tableNoRls"]);
    expect(GRAPH_LENSES[0].legend).toHaveLength(3);
  });

  it("summarizes by node, not by diagnostic", () => {
    const summary = summarizeLens("security", [WRITE, ADMIN, NO_RLS, ELEVATED]);
    expect(summary.count).toBe(3);
    expect(summary.flagged).toEqual(
      new Set(["route:POST /api/todos", "route:GET /api/admin/users", "table:todos"]),
    );
    expect(summary.byNode.get("route:POST /api/todos")).toEqual([WRITE]);
  });

  it("keeps every diagnostic of a node for the callout", () => {
    const both = [WRITE, { ...ADMIN, nodeId: WRITE.nodeId } satisfies GraphDiagnostic];
    const grouped = diagnosticsByNode(both);
    expect(grouped.get(WRITE.nodeId)).toHaveLength(2);
    expect(lensHighlight(summarizeLens("security", both)).codeOf.get(WRITE.nodeId)).toBe(
      "publicWrite",
    );
  });
});

describe("diagnostic translation", () => {
  it("renders the params through t() and re-translates on a language switch", () => {
    const key = DIAGNOSTIC_MESSAGE_KEYS.shared;
    const params = diagnosticParams(SHARED);
    const english = t(key, params);
    expect(english).toContain("Referenced by 2 other domains (billing, todos)");
    setLocale("it");
    const italian = t(key, params);
    expect(italian).toContain("Referenziato da 2 altri domini");
    expect(italian).toContain("billing, todos");
    expect(italian).not.toBe(english);
  });

  it("renders every code without leaking English prose in the params", () => {
    for (const entry of ALL) {
      const text = t(DIAGNOSTIC_MESSAGE_KEYS[entry.code], diagnosticParams(entry));
      expect(text).not.toContain("projectGraph.surface.diag");
    }
  });
});

describe("draw-only lens state", () => {
  const view: ProjectGraphView = {
    nodes: [
      {
        id: "table:todos",
        kind: "table",
        label: "todos",
        sourceFile: "db/schema.ts",
        position: { x: 10, y: 20 },
        matched: true,
        collapsed: false,
        data: {
          kind: "table",
          table: "todos",
          columns: [],
          rlsEnabled: true,
          scope: null,
          policies: [],
          framework: false,
          unknown: false,
        },
      },
    ],
    edges: [],
    stats: {
      pages: 0,
      routes: 0,
      tables: 1,
      views: 0,
      workflows: 0,
      edges: 0,
      hiddenEdges: 0,
      hiddenNodes: 0,
      matches: 0,
      unknownNodes: 0,
      pageLinks: 0,
      elevatedEdges: 0,
    },
  };

  it("computes domain flags without mutating the layout inputs", () => {
    const key = surfaceLayoutKey(view);
    const summary = summarizeLens("security", [NO_RLS]);
    const highlight = lensHighlight(summary);
    const counts = domainFlagCounts(new Map([["table:todos", "todos"]]), highlight.flagged);
    expect(counts.get("todos")).toBe(1);
    expect(surfaceLayoutKey(view)).toBe(key);
    expect(view.nodes[0].position).toEqual({ x: 10, y: 20 });
  });
});

describe("lens registry (D-224, #198)", () => {
  it("declares a source for every lens and keeps the analyzer lenses static", () => {
    expect(GRAPH_LENSES.map((lens) => [lens.id, lens.source])).toEqual([
      ["security", "static"],
      ["elevated", "static"],
      ["shared", "static"],
      ["unknown", "static"],
    ]);
    for (const lens of GRAPH_LENSES) {
      expect(GRAPH_LENS_SOURCES).toContain(lens.source);
    }
  });

  it("maps every code to exactly one lens", () => {
    const owner = new Map<GraphLensCode, string>();
    for (const lens of GRAPH_LENSES) {
      for (const code of lens.codes) {
        expect(owner.has(code)).toBe(false);
        owner.set(code, lens.id);
        expect(lensForCode(code)).toBe(lens.id);
      }
    }
    for (const code of Object.keys(DIAGNOSTIC_MESSAGE_KEYS) as GraphLensCode[]) {
      expect(owner.get(code)).toBe(LENS_BY_CODE[code as keyof typeof LENS_BY_CODE]);
    }
  });

  it("gives every code a message key, a label key and a colour token", () => {
    for (const lens of GRAPH_LENSES) {
      expect(lens.legend.map((entry) => entry.code)).toEqual([...lens.codes]);
      expect(lens.colorToken).toMatch(/^--[a-z-]+$/);
      for (const entry of lens.legend) {
        expect(t(entry.messageKey)).not.toContain("projectGraph.surface");
        expect(t(entry.labelKey)).not.toContain("projectGraph.surface");
        expect(entry.colorToken).toMatch(/^--[a-z-]+$/);
      }
    }
  });

  it("keeps the four static lens labels byte-identical", () => {
    expect(GRAPH_LENSES.map((lens) => t(lens.titleKey))).toEqual([
      "Q5 · Security",
      "Q4 · Elevated (sudo / system)",
      "Q9 · Shared across groups",
      "Q17 · Unknown",
    ]);
    expect(GRAPH_LENSES.map((lens) => t(lens.shortKey))).toEqual(["Q5", "Q4", "Q9", "Q17"]);
  });

  it("keeps the state vocabulary disjoint from the analyzer's", () => {
    for (const code of Object.keys(DIAGNOSTIC_MESSAGE_KEYS) as GraphLensCode[]) {
      expect(isStateCode(code)).toBe(false);
    }
    expect(isStateCode("state.noTraffic")).toBe(true);
    expect(lensForCode("state.noTraffic")).toBeNull();
  });
});
