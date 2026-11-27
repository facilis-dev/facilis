// The prerender lens's facts (D-225, Q21): every routed page is prerendered, eligible but
// undeclared, ineligible with one code per blocker, or unknown when no fact exists. Pure and
// read-only: the facts and the page join are the analyzer's (D-202), the lens only classifies.

import type { PrerenderEligibilityFact, PrerenderIneligibilityReason } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphView } from "../graph-model";
import { prerenderFactForPage } from "../graph-prerender";
import { deriveDomains, domainIndex } from "./domains.ts";
import type { GraphLensCode } from "./lenses.ts";
import type { GraphLensState, GraphStateFact } from "./state-facts.ts";

/** Position in the answers list: what prerenders first, what blocks it last. */
const RANK = { prerendered: 0, eligible: 1, ineligible: 2, unknown: 3 } as const;

const REASON_CODES: Readonly<Record<PrerenderIneligibilityReason, GraphLensCode>> = {
  "private-api": "state.privateApi",
  "auth-guarded": "state.authGuarded",
  "unknown-security": "state.unknownSecurity",
  "dynamic-path": "state.dynamicPath",
  redirect: "state.redirect",
};

const REASON_SHORT_KEYS: Readonly<Record<PrerenderIneligibilityReason, MessageKey>> = {
  "private-api": "projectGraph.surface.state.privateApi.short",
  "auth-guarded": "projectGraph.surface.state.authGuarded.short",
  "unknown-security": "projectGraph.surface.state.unknownSecurity.short",
  "dynamic-path": "projectGraph.surface.state.dynamicPath.short",
  redirect: "projectGraph.surface.state.redirect.short",
};

const REASON_TOKENS: Readonly<Record<PrerenderIneligibilityReason, string>> = {
  "private-api": "--warning",
  "auth-guarded": "--warning",
  "unknown-security": "--muted-foreground",
  "dynamic-path": "--warning",
  redirect: "--warning",
};

interface PageEntry {
  readonly nodeId: string;
  readonly label: string;
  readonly fact: PrerenderEligibilityFact | null;
  readonly rank: number;
}

function badge(textKey: MessageKey, colorToken: string): { text: string; colorToken: string } {
  return { text: t(textKey), colorToken };
}

function ineligibleBadge(reasons: readonly PrerenderIneligibilityReason[]): {
  text: string;
  colorToken: string;
} {
  const first = reasons[0];
  return first === undefined
    ? badge("projectGraph.surface.state.prerenderIneligible.short", "--warning")
    : badge(REASON_SHORT_KEYS[first], REASON_TOKENS[first]);
}

export function buildPrerenderLensState(
  allFacts: readonly PrerenderEligibilityFact[],
  view: ProjectGraphView | null,
): GraphLensState {
  const entries: PageEntry[] = [];
  for (const node of view?.nodes ?? []) {
    // An unrouted page has no URL to prerender; it is not an unanswered prerender question.
    if (node.data.kind !== "page" || node.data.routePaths.length === 0) continue;
    const fact = prerenderFactForPage(allFacts, node.data.routePaths);
    const rank =
      fact === null
        ? RANK.unknown
        : !fact.eligible
          ? RANK.ineligible
          : fact.declared
            ? RANK.prerendered
            : RANK.eligible;
    entries.push({ nodeId: node.id, label: node.label, fact, rank });
  }
  if (entries.length === 0) {
    return {
      facts: [],
      totals: null,
      params: {},
      contextKey: null,
      emptyKey: "projectGraph.surface.state.noPages",
      emptyHintKey: "projectGraph.surface.state.prerender.emptyHint",
      badges: new Map(),
    };
  }
  entries.sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
  const facts: GraphStateFact[] = [];
  const badges = new Map<string, { text: string; colorToken: string }>();
  let prerendered = 0;
  let eligible = 0;
  let ineligible = 0;
  let unknown = 0;
  for (const entry of entries) {
    const fact = entry.fact;
    if (fact === null) {
      unknown += 1;
      facts.push({
        nodeId: entry.nodeId,
        code: "state.prerenderUnknown",
        params: { path: entry.label },
      });
      badges.set(
        entry.nodeId,
        badge("projectGraph.surface.state.prerenderUnknown.short", "--muted-foreground"),
      );
      continue;
    }
    if (!fact.eligible) {
      ineligible += 1;
      const reasons = fact.reasons;
      if (reasons.length === 0) {
        facts.push({
          nodeId: entry.nodeId,
          code: "state.prerenderIneligible",
          params: { path: fact.path },
        });
        badges.set(
          entry.nodeId,
          badge("projectGraph.surface.state.prerenderIneligible.short", "--warning"),
        );
      } else {
        for (const reason of reasons) {
          facts.push({
            nodeId: entry.nodeId,
            code: REASON_CODES[reason.reason],
            params: {
              path: fact.path,
              ...(reason.route === undefined ? {} : { route: reason.route }),
            },
          });
        }
        badges.set(entry.nodeId, ineligibleBadge(reasons.map((reason) => reason.reason)));
      }
      continue;
    }
    if (fact.declared) {
      prerendered += 1;
      facts.push({ nodeId: entry.nodeId, code: "state.prerendered", params: { path: fact.path } });
      badges.set(entry.nodeId, badge("projectGraph.surface.state.prerendered.short", "--success"));
      continue;
    }
    eligible += 1;
    facts.push({
      nodeId: entry.nodeId,
      code: "state.prerenderEligible",
      params: { path: fact.path },
    });
    badges.set(entry.nodeId, badge("projectGraph.surface.state.prerenderEligible.short", "--info"));
  }
  return {
    facts,
    totals: {
      key: "projectGraph.surface.state.prerender.totals",
      count: entries.length,
      params: { prerendered, eligible, ineligible, unknown },
    },
    params: {},
    contextKey: null,
    emptyKey: null,
    emptyHintKey: null,
    badges,
    highlight: entries.map((entry) => entry.nodeId),
    groups: domainIndex(deriveDomains(view?.nodes ?? [], view?.edges ?? [])),
  };
}
