import { describe, expect, it } from "vitest";
import { pageId, type PrerenderEligibilityFact, type SourceRef } from "@facilis.dev/analyze";
import {
  isPrerendered,
  prerenderChips,
  prerenderFactForPage,
  prerenderFactForPath,
  prerenderedPagesForRoute,
} from "./graph-prerender";
import type { ProjectGraphNode } from "./graph-types";

const ref = (file: string, line: number): SourceRef => ({ file, line });

function fact(overrides: Partial<PrerenderEligibilityFact> = {}): PrerenderEligibilityFact {
  return {
    path: "/about",
    declared: false,
    eligible: true,
    reasons: [],
    pageFile: "src/pages/about.tsx",
    source: ref("src/app.tsx", 4),
    unknown: [],
    ...overrides,
  };
}

function pageNode(path: string, routePaths: readonly string[]): ProjectGraphNode {
  return {
    id: pageId(path),
    kind: "page",
    label: path,
    sourceFile: path,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page",
      pagePath: path,
      pageKind: "page",
      callCount: 0,
      routePaths,
      preview: null,
    },
  };
}

describe("prerenderFactForPath / prerenderFactForPage", () => {
  const facts = [
    fact(),
    fact({ path: "/pricing", eligible: false, reasons: [{ reason: "auth-guarded" }] }),
  ];

  it("joins by the exact route-table path", () => {
    expect(prerenderFactForPath(facts, "/about")?.path).toBe("/about");
    expect(prerenderFactForPath(facts, "/missing")).toBeNull();
  });

  it("takes the first page path with a fact", () => {
    expect(prerenderFactForPage(facts, ["/missing", "/pricing"])?.path).toBe("/pricing");
    expect(prerenderFactForPage(facts, [])).toBeNull();
  });
});

describe("prerenderChips", () => {
  it("returns no chips for a missing fact (unknown is never eligible)", () => {
    expect(prerenderChips(null)).toEqual([]);
  });

  it("shows one positive chip for an eligible page", () => {
    expect(prerenderChips(fact())).toEqual([
      { id: "eligible", reason: "eligible", route: null, tone: "brand" },
    ]);
  });

  it("names the offending route for private-api", () => {
    const chips = prerenderChips(
      fact({ eligible: false, reasons: [{ reason: "private-api", route: "GET /api/stats" }] }),
    );
    expect(chips).toEqual([
      {
        id: "private-api:GET /api/stats",
        reason: "private-api",
        route: "GET /api/stats",
        tone: "warning",
      },
    ]);
  });

  it("maps every blocking reason to a warning chip", () => {
    const chips = prerenderChips(
      fact({
        eligible: false,
        reasons: [
          { reason: "auth-guarded" },
          { reason: "unknown-security" },
          { reason: "dynamic-path" },
          { reason: "redirect" },
        ],
      }),
    );
    expect(chips.map((chip) => chip.reason)).toEqual([
      "auth-guarded",
      "unknown-security",
      "dynamic-path",
      "redirect",
    ]);
    expect(chips.every((chip) => chip.tone === "warning")).toBe(true);
  });
});

describe("isPrerendered", () => {
  it("requires both declared and eligible", () => {
    expect(isPrerendered(fact({ declared: true }))).toBe(true);
    expect(isPrerendered(fact({ declared: false }))).toBe(false);
    expect(isPrerendered(fact({ declared: true, eligible: false }))).toBe(false);
  });
});

describe("prerenderedPagesForRoute", () => {
  const routeId = "route:GET /api/stats";
  const nodes = [
    pageNode("src/pages/about.tsx", ["/about"]),
    pageNode("src/pages/home.tsx", ["/"]),
    pageNode("src/pages/private.tsx", ["/private"]),
  ];
  const edges = [
    { kind: "page-route", source: pageId("src/pages/about.tsx"), target: routeId },
    { kind: "page-route", source: pageId("src/pages/home.tsx"), target: routeId },
    { kind: "page-route", source: pageId("src/pages/private.tsx"), target: routeId },
    { kind: "page-route", source: pageId("src/pages/about.tsx"), target: "route:GET /api/other" },
    { kind: "page-link", source: pageId("src/pages/home.tsx"), target: routeId },
  ];

  it("lists only declared-and-eligible pages calling the route", () => {
    const facts = [
      fact({ declared: true }),
      fact({ path: "/", declared: false }),
      fact({
        path: "/private",
        declared: true,
        eligible: false,
        reasons: [{ reason: "auth-guarded" }],
      }),
    ];
    expect(prerenderedPagesForRoute(facts, nodes, edges, routeId)).toEqual([
      { id: pageId("src/pages/about.tsx"), path: "/about" },
    ]);
  });

  it("is empty when nothing is declared", () => {
    expect(prerenderedPagesForRoute([fact()], nodes, edges, routeId)).toEqual([]);
  });

  it("sorts by path and deduplicates repeated edges", () => {
    const facts = [fact({ declared: true }), fact({ path: "/", declared: true })];
    const doubled = [...edges, edges[0] as (typeof edges)[number]];
    expect(prerenderedPagesForRoute(facts, nodes, doubled, routeId)).toEqual([
      { id: pageId("src/pages/home.tsx"), path: "/" },
      { id: pageId("src/pages/about.tsx"), path: "/about" },
    ]);
  });
});
