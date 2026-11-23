// Prerender fact model (D-202, SPEC §5.11), split from types.ts so the base fact model
// stays under the 300-line source limit. Eligibility is a fail-closed static fact: a page is
// prerender-eligible only when it is a param-free route-table page, no session-dependent
// guard wraps it, and every API it calls is explicitly public (permission: [], D-116).
// Unknown is never guessed (D-092); rendering happens only in the build pass, never here.

import type { SourceRef, UnknownFact } from "./types.ts";

/** Why a page cannot be prerendered; each reason is a first-class fact (D-202 §3). */
export type PrerenderIneligibilityReason =
  "private-api" | "auth-guarded" | "unknown-security" | "dynamic-path" | "redirect";

export interface PrerenderIneligibilityFact {
  readonly reason: PrerenderIneligibilityReason;
  /** The offending API route ("GET /api/stats") for private-api; absent otherwise. */
  readonly route?: string;
}

/** One route-table page path (or a declared path that resolves to no page). */
export interface PrerenderEligibilityFact {
  /** The route-table page path, e.g. "/about"; the declared path when unresolved. */
  readonly path: string;
  /** True when the path is in the project's prerender allowlist. */
  readonly declared: boolean;
  readonly eligible: boolean;
  readonly reasons: readonly PrerenderIneligibilityFact[];
  /** The src/pages/ component behind the entry; null when none resolves. */
  readonly pageFile: string | null;
  readonly source: SourceRef;
  readonly unknown: readonly UnknownFact[];
}

/** The prerender declaration read from facilis.config.ts (mirrors the core defaults). */
export interface ConfigPrerenderFacts {
  readonly routes: readonly string[];
  readonly origin: string | null;
  readonly unknown: readonly UnknownFact[];
}

/** A declared-but-ineligible route: the build must fail with this code (D-202 §3). */
export interface PrerenderBuildError {
  readonly code: "prerender-ineligible";
  readonly route: string;
  readonly reasons: readonly PrerenderIneligibilityFact[];
}
