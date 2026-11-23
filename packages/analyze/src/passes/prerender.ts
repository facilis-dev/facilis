/**
 * Prerender eligibility facts (D-202 §3, SPEC §5.11): one fact per concrete route-table
 * entry, plus one per declared path that resolves to no entry.
 *
 * Fail closed, zero execution (D-092): a page is eligible iff its entry is param-free, its
 * element resolves to a src/pages/ component (a Navigate redirect is not a page), no imported
 * session-dependent guard wraps it or any ancestor, and every API call it makes targets an
 * explicitly public route (permission: [], D-116). Anything unreadable is an unknown fact and
 * an ineligibility reason, never a guess. A declared-but-ineligible route fails the build via
 * `prerenderBuildErrors` — the shared input of both framework build gates.
 */

import { error } from "../diagnostics.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { Diagnostic, PageFact, RouteCallFact, RouteFact, UnknownFact } from "../types.ts";
import type {
  PrerenderBuildError,
  PrerenderEligibilityFact,
  PrerenderIneligibilityFact,
} from "../types-prerender.ts";
import { elementName } from "./jsx.ts";
import { hasAuthGuard, navigateLocals } from "./prerender-guards.ts";
import type { PrerenderDeclaration } from "./prerender-vite.ts";
import { routeFactId } from "./route-location.ts";
import { buildRouteTable } from "./route-table.ts";
import { appFileOf, pagePathOfElement, pathMatches } from "./screens.ts";
import { sortDiagnostics } from "./static-read.ts";

export interface PrerenderResult {
  readonly facts: readonly PrerenderEligibilityFact[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Route params and catch-alls: ":id", "{id}", "{*slug}", "*" (the pathMatches vocabulary). */
function hasParam(path: string): boolean {
  return /[:*{}]/.test(path);
}

function pushReason(reasons: PrerenderIneligibilityFact[], fact: PrerenderIneligibilityFact): void {
  if (!reasons.some((entry) => entry.reason === fact.reason && entry.route === fact.route)) {
    reasons.push(fact);
  }
}

/** Join one page API call against the route security facts; unknown is never "public". */
function callReasons(
  call: RouteCallFact,
  routesById: ReadonlyMap<string, RouteFact>,
  reasons: PrerenderIneligibilityFact[],
  unknown: UnknownFact[],
): void {
  const unreadable =
    call.kind === "dynamic" ||
    call.kind === "unknown" ||
    call.unknown.length > 0 ||
    call.matchedRouteIds.length === 0;
  if (unreadable) {
    pushReason(reasons, { reason: "unknown-security" });
    unknown.push(...call.unknown);
    if (call.unknown.length === 0) {
      unknown.push({
        code: "prerender-call-unresolved",
        reason: `API call ${call.expression} matches no route statically`,
        source: call.source,
      });
    }
    return;
  }
  for (const id of call.matchedRouteIds) {
    const route = routesById.get(id);
    if (route === undefined) {
      pushReason(reasons, { reason: "unknown-security" });
      unknown.push({
        code: "prerender-call-unresolved",
        reason: `matched route ${id} has no route fact`,
        source: call.source,
      });
      continue;
    }
    if (route.permission === null) {
      pushReason(reasons, { reason: "unknown-security" });
      unknown.push({
        code: "prerender-security-unknown",
        reason: `permission of ${route.method} ${route.path} cannot be read statically`,
        source: route.source,
      });
    } else if (route.permission.length > 0) {
      pushReason(reasons, { reason: "private-api", route: `${route.method} ${route.path}` });
    }
  }
}

/** "(private-api: GET /api/stats; auth-guarded)" — the shared reason rendering. */
export function formatPrerenderReasons(reasons: readonly PrerenderIneligibilityFact[]): string {
  const details = reasons
    .map((fact) =>
      fact.reason === "private-api"
        ? `${fact.reason}: ${fact.route ?? "unknown route"}`
        : fact.reason,
    )
    .join("; ");
  return `(${details})`;
}

/** Declared-and-ineligible routes: the build must fail with these (D-202 §3, fail closed). */
export function prerenderBuildErrors(
  facts: readonly PrerenderEligibilityFact[],
): PrerenderBuildError[] {
  return facts
    .filter((fact) => fact.declared && !fact.eligible)
    .map((fact) => ({ code: "prerender-ineligible", route: fact.path, reasons: fact.reasons }));
}

/** Build the page-level eligibility facts from the declaration, route table and page facts. */
export function buildPrerenderFacts(
  graph: ModuleGraph,
  declaration: PrerenderDeclaration,
  routes: readonly RouteFact[],
  pages: readonly PageFact[],
): PrerenderResult {
  const appFile = appFileOf(graph);
  const entries = appFile === null ? [] : buildRouteTable(graph, appFile);
  const routesById = new Map(routes.map((route) => [routeFactId(route), route]));
  const pagesByFile = new Map(pages.map((page) => [page.path, page]));
  const navigate = appFile === null ? new Set<string>() : navigateLocals(appFile);
  const facts: PrerenderEligibilityFact[] = [];
  const matchedDeclared = new Set<string>();

  entries.forEach((entry, index) => {
    // A pathless layout inherits its parent path; it is chrome, not a prerenderable page.
    if (entry.pathless) return;
    const reasons: PrerenderIneligibilityFact[] = [];
    const unknown: UnknownFact[] = [];
    if (hasParam(entry.path)) pushReason(reasons, { reason: "dynamic-path" });
    const pageFile =
      appFile !== null && entry.element !== null
        ? pagePathOfElement(graph, appFile.path, entry.element)
        : null;
    const rootName = entry.element === null ? null : elementName(entry.element);
    if (rootName !== null && navigate.has(rootName) && pageFile === null) {
      pushReason(reasons, { reason: "redirect" });
    } else if (pageFile === null) {
      pushReason(reasons, { reason: "unknown-security" });
      unknown.push({
        code: "prerender-page-unresolved",
        reason: `route "${entry.path}" resolves to no src/pages/ component`,
        source: entry.source,
      });
    }
    if (appFile !== null && hasAuthGuard(graph, appFile, entries, index)) {
      pushReason(reasons, { reason: "auth-guarded" });
    }
    const page = pageFile === null ? undefined : pagesByFile.get(pageFile);
    for (const call of page?.calls ?? []) callReasons(call, routesById, reasons, unknown);
    const declared = declaration.routes.some((route) => {
      if (!pathMatches(entry.path, route)) return false;
      matchedDeclared.add(route);
      return true;
    });
    facts.push({
      path: entry.path,
      declared,
      eligible: reasons.length === 0,
      reasons,
      pageFile,
      source: entry.source,
      unknown,
    });
  });

  // A declared path with no route-table page is unknown, never silently skipped (D-092).
  const fallbackSource = declaration.source ?? { file: "facilis.config.ts", line: 1 };
  for (const route of declaration.routes) {
    if (matchedDeclared.has(route)) continue;
    facts.push({
      path: route,
      declared: true,
      eligible: false,
      reasons: [{ reason: "unknown-security" }],
      pageFile: null,
      source: fallbackSource,
      unknown: [
        {
          code: "prerender-page-unresolved",
          reason: `declared prerender route "${route}" matches no page in the route table`,
          source: fallbackSource,
        },
      ],
    });
  }

  const diagnostics: Diagnostic[] = [];
  for (const fact of facts) {
    if (!fact.declared || fact.eligible) continue;
    diagnostics.push(
      error(
        "prerender-ineligible",
        `prerender route "${fact.path}" is not prerender-eligible ${formatPrerenderReasons(fact.reasons)}`,
        fact.source,
      ),
    );
  }
  return { facts, diagnostics: sortDiagnostics(diagnostics) };
}
