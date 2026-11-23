// The Release Preview's prerender surface (D-202, issue #84): per-page render mode and its
// diff across two refs.
//
// Pure and fail-closed: the render mode is derivable from the analyzer facts alone
// (declared ∧ eligible → prerendered at build time, everything else client-rendered — D-202
// §7). When either side's facts could not be read the diff is null and the panel says
// "unavailable"; a missing fact is never guessed into a mode (D-092).

import type { PrerenderEligibilityFact } from "@facilis.dev/analyze";

export type PageRenderMode = "prerender" | "client";

export interface PageRenderState {
  readonly mode: PageRenderMode;
  readonly declared: boolean;
  readonly eligible: boolean;
}

/** One page's render mode at one ref; a declared-but-ineligible page stays client (and
 * fails the build — the lens flags it separately rather than hiding it). */
export function pageRenderState(fact: PrerenderEligibilityFact): PageRenderState {
  return {
    mode: fact.declared && fact.eligible ? "prerender" : "client",
    declared: fact.declared,
    eligible: fact.eligible,
  };
}

export interface PrerenderSurfaceRow {
  readonly path: string;
  /** null when the route-table entry does not exist at that ref. */
  readonly before: PageRenderState | null;
  readonly after: PageRenderState | null;
}

export interface PrerenderSurfaceDiff {
  /** Every page path on either side, sorted; the per-page render-mode flags. */
  readonly rows: readonly PrerenderSurfaceRow[];
  /** Paths prerendered only on the after side. */
  readonly added: readonly string[];
  /** Paths prerendered only on the before side. */
  readonly removed: readonly string[];
  /** Paths whose declaration/eligibility changed without moving the prerendered set. */
  readonly changed: readonly string[];
}

function statesByPath(
  facts: readonly PrerenderEligibilityFact[],
): ReadonlyMap<string, PageRenderState> {
  return new Map(facts.map((fact) => [fact.path, pageRenderState(fact)]));
}

function sameState(left: PageRenderState, right: PageRenderState): boolean {
  return (
    left.mode === right.mode && left.declared === right.declared && left.eligible === right.eligible
  );
}

/**
 * Diff the prerender surface between two refs. Null when either side is unreadable — the
 * caller renders "unavailable", never a partial guess.
 */
export function diffPrerenderSurfaces(
  before: readonly PrerenderEligibilityFact[] | null,
  after: readonly PrerenderEligibilityFact[] | null,
): PrerenderSurfaceDiff | null {
  if (before === null || after === null) return null;
  const beforeStates = statesByPath(before);
  const afterStates = statesByPath(after);
  const paths = [...new Set([...beforeStates.keys(), ...afterStates.keys()])].toSorted(
    (left, right) => left.localeCompare(right),
  );
  const rows: PrerenderSurfaceRow[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const path of paths) {
    const beforeState = beforeStates.get(path) ?? null;
    const afterState = afterStates.get(path) ?? null;
    rows.push({ path, before: beforeState, after: afterState });
    const wasPrerendered = beforeState?.mode === "prerender";
    const isPrerendered = afterState?.mode === "prerender";
    if (isPrerendered && !wasPrerendered) added.push(path);
    else if (wasPrerendered && !isPrerendered) removed.push(path);
    else if (beforeState !== null && afterState !== null && !sameState(beforeState, afterState)) {
      changed.push(path);
    }
  }
  return { rows, added, removed, changed };
}
