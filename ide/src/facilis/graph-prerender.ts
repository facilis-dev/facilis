// The prerender facts joined to the project graph (D-202, issue #84).
//
// Pure: the panel already holds the Analysis, so the inspector's eligibility chips and the
// route satellite's "prerendered pages calling it" list are joins over facts, node ids and
// page-route edges — never a re-read or a guess. A page with no fact is unknown, not eligible
// (D-092): the chip mapping returns nothing and the inspector says so.

import type { PrerenderEligibilityFact, PrerenderIneligibilityReason } from "@facilis.dev/analyze";
import type { ProjectGraphNode } from "./graph-types";

/** The fact for one route-table path, or null when the analyzer produced none. */
export function prerenderFactForPath(
  facts: readonly PrerenderEligibilityFact[],
  path: string,
): PrerenderEligibilityFact | null {
  return facts.find((fact) => fact.path === path) ?? null;
}

/** The fact for a page node: its first declared route path wins (the preview's path). */
export function prerenderFactForPage(
  facts: readonly PrerenderEligibilityFact[],
  routePaths: readonly string[],
): PrerenderEligibilityFact | null {
  for (const path of routePaths) {
    const fact = prerenderFactForPath(facts, path);
    if (fact !== null) return fact;
  }
  return null;
}

export type PrerenderChipReason = "eligible" | PrerenderIneligibilityReason;

export interface PrerenderChip {
  /** Stable key: the reason plus the offending route when one is named. */
  readonly id: string;
  readonly reason: PrerenderChipReason;
  /** The offending API route ("GET /api/stats") for private-api; null otherwise. */
  readonly route: string | null;
  readonly tone: "brand" | "warning";
}

/**
 * The eligibility chips: one positive "eligible" chip, or one warning chip per blocking
 * reason. The analyzer already deduplicates reasons; the order is the fact's own.
 */
export function prerenderChips(fact: PrerenderEligibilityFact | null): readonly PrerenderChip[] {
  if (fact === null) return [];
  if (fact.eligible) {
    return [{ id: "eligible", reason: "eligible", route: null, tone: "brand" }];
  }
  return fact.reasons.map((reason) => ({
    id: reason.reason + ":" + (reason.route ?? ""),
    reason: reason.reason,
    route: reason.route ?? null,
    tone: "warning",
  }));
}

/** A page prerenders iff it is declared AND eligible — the render mode is derivable (D-202). */
export function isPrerendered(fact: PrerenderEligibilityFact): boolean {
  return fact.declared && fact.eligible;
}

export interface PrerenderedPageRef {
  readonly id: string;
  readonly path: string;
}

/** Minimal edge shape: the analyzer's GraphEdge and the view's ProjectGraphEdge both fit. */
interface EdgeLike {
  readonly kind: string;
  readonly source: string;
  readonly target: string;
}

/**
 * The pages that prerender against one API route: a page-route edge into it whose page is
 * declared and eligible. Only public routes can have any (eligibility requires every call
 * to be permission: [], D-116); the caller still gates the section on the route's permission.
 */
export function prerenderedPagesForRoute(
  facts: readonly PrerenderEligibilityFact[],
  nodes: readonly ProjectGraphNode[],
  edges: readonly EdgeLike[],
  routeId: string,
): readonly PrerenderedPageRef[] {
  const prerenderedPaths = new Set(facts.filter(isPrerendered).map((fact) => fact.path));
  if (prerenderedPaths.size === 0) return [];
  const pagesById = new Map(
    nodes.filter((node) => node.data.kind === "page").map((node) => [node.id, node] as const),
  );
  const refs = new Map<string, PrerenderedPageRef>();
  for (const edge of edges) {
    if (edge.kind !== "page-route" || edge.target !== routeId) continue;
    const page = pagesById.get(edge.source);
    if (page === undefined || page.data.kind !== "page") continue;
    const path = page.data.routePaths.find((candidate) => prerenderedPaths.has(candidate));
    if (path !== undefined) refs.set(page.id, { id: page.id, path });
  }
  return [...refs.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}
