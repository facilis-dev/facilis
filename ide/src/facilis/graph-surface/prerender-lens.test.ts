// The prerender lens's classification (D-224, Q21): declared-eligible, eligible-undeclared,
// ineligible with one code per blocker, and unknown when the analyzer produced no fact. Pure
// inputs, so the three counts, the reason codes and the layout invariance are unit-testable.

import type { PrerenderEligibilityFact } from "@facilis.dev/analyze";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { surfaceLayoutKey } from "./positions.ts";
import { buildPrerenderLensState } from "./prerender-lens.ts";

const STATS = {
  pages: 5,
  routes: 0,
  tables: 0,
  views: 0,
  workflows: 0,
  edges: 0,
  hiddenEdges: 0,
  hiddenNodes: 0,
  matches: 0,
  unknownNodes: 0,
  pageLinks: 0,
  elevatedEdges: 0,
};

function pageNode(path: string, routePaths: readonly string[] = [path]) {
  return {
    id: "page:" + path,
    kind: "page" as const,
    label: path,
    sourceFile: "src/pages" + path + ".tsx",
    position: { x: 7, y: 8 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page" as const,
      pagePath: path,
      pageKind: "page" as const,
      callCount: 1,
      routePaths,
      preview: null,
    },
  };
}

function fact(
  path: string,
  declared: boolean,
  eligible: boolean,
  reasons: PrerenderEligibilityFact["reasons"] = [],
): PrerenderEligibilityFact {
  return {
    path,
    declared,
    eligible,
    reasons,
    pageFile: "src/pages" + path + ".tsx",
    source: { file: "src/routes.tsx", line: 1 },
    unknown: [],
  };
}

const ABOUT = pageNode("/about");
const PRICING = pageNode("/pricing");
const TODOS = pageNode("/todos");
const FAQ = pageNode("/faq");
const UNROUTED = pageNode("/draft", []);
const VIEW: ProjectGraphView = {
  nodes: [ABOUT, PRICING, TODOS, FAQ, UNROUTED],
  edges: [],
  stats: STATS,
};

const FACTS: readonly PrerenderEligibilityFact[] = [
  fact("/about", true, true),
  fact("/pricing", false, true),
  fact("/todos", false, false, [{ reason: "private-api", route: "GET /api/todos" }]),
];

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("prerender lens", () => {
  it("classifies declared, eligible, ineligible and unknown pages", () => {
    const state = buildPrerenderLensState(FACTS, VIEW);
    expect(state.totals).toMatchObject({
      count: 4,
      params: { prerendered: 1, eligible: 1, ineligible: 1, unknown: 1 },
    });
    const codeOf = new Map(state.facts.map((entry) => [entry.nodeId, entry.code]));
    expect(codeOf.get(ABOUT.id)).toBe("state.prerendered");
    expect(codeOf.get(PRICING.id)).toBe("state.prerenderEligible");
    expect(codeOf.get(TODOS.id)).toBe("state.privateApi");
    expect(codeOf.get(FAQ.id)).toBe("state.prerenderUnknown");
    expect(codeOf.has(UNROUTED.id)).toBe(false);
    expect(state.badges.get(ABOUT.id)?.text).toBe("PR");
    expect(state.badges.get(PRICING.id)?.text).toBe("EL");
    expect(state.badges.get(TODOS.id)?.text).toBe("API");
    expect(state.badges.get(FAQ.id)?.text).toBe("?");
    expect(state.highlight).toEqual([ABOUT.id, PRICING.id, TODOS.id, FAQ.id]);
    expect(state.groups?.has(ABOUT.id)).toBe(true);
  });

  it("renders the counts and the ineligible reason from codes with params", () => {
    const state = buildPrerenderLensState(FACTS, VIEW);
    const total = t(state.totals?.key ?? "projectGraph.surface.state.noPages", {
      count: state.totals?.count ?? 0,
      ...state.totals?.params,
    });
    expect(total).toBe("pages: 4 · prerendered: 1 · eligible: 1 · ineligible: 1 · unknown: 1");
    const reason = state.facts.find((entry) => entry.nodeId === TODOS.id);
    expect(reason?.params).toEqual({ path: "/todos", route: "GET /api/todos" });
    expect(t("projectGraph.surface.state.privateApi", reason?.params ?? {})).toContain(
      "GET /api/todos",
    );
    expect(t("projectGraph.surface.state.prerenderEligible", { path: "/pricing" })).toContain(
      "add /pricing",
    );
  });

  it("re-translates the ineligible reason in it", () => {
    const english = t("projectGraph.surface.state.privateApi", { route: "GET /api/todos" });
    setLocale("it");
    const italian = t("projectGraph.surface.state.privateApi", { route: "GET /api/todos" });
    expect(italian).not.toBe(english);
    expect(italian).toContain("permesso");
  });

  it("keeps every blocker when a page has more than one", () => {
    const state = buildPrerenderLensState(
      [fact("/todos", true, false, [{ reason: "auth-guarded" }, { reason: "dynamic-path" }])],
      { ...VIEW, nodes: [TODOS] },
    );
    expect(state.facts.map((entry) => entry.code)).toEqual([
      "state.authGuarded",
      "state.dynamicPath",
    ]);
    expect(state.badges.get(TODOS.id)?.text).toBe("AUTH");
  });

  it("explains a project with no routed page and does not move a node", () => {
    const empty = buildPrerenderLensState(FACTS, { ...VIEW, nodes: [UNROUTED] });
    expect(empty.emptyKey).toBe("projectGraph.surface.state.noPages");
    const key = surfaceLayoutKey(VIEW);
    const before = VIEW.nodes.map((node) => [node.id, node.position]);
    buildPrerenderLensState(FACTS, VIEW);
    expect(VIEW.nodes.map((node) => [node.id, node.position])).toEqual(before);
    expect(surfaceLayoutKey(VIEW)).toBe(key);
  });
});
