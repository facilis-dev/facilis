/**
 * Rule 23 `reserved-route-prefix` (SPEC §8.6/§9.3, D-215): a project route may not shadow a
 * framework-owned path (invariant 6, D-107/D-116/D-120). The framework registers the control
 * plane (`/__facilis/**`, the OpenAPI documents), the SSO namespace (`/api/auth/sso/**`) and
 * the token endpoint (`/api/auth/token`) itself, in dev and production; an app route on one of
 * those paths is shadowed or shadows a framework handler.
 *
 * The rule reads the effective post-patch Analysis' route facts (the path Nitro's file router
 * derives, plus the source file), never a re-parse of the patch. `/api/files/**` and
 * `/api/jobs/**` are the app's own trees (D-215): the framework registers no handler there.
 */

import { reservedRoutePathOf, type RouteFact } from "@facilis.dev/analyze";

import type { EffectiveState } from "../overlay.ts";
import type { ValidationError } from "../types.ts";

export const RESERVED_ROUTE_PREFIX_RULE = "reserved-route-prefix";

function finding(route: RouteFact, why: string): ValidationError {
  return {
    rule: RESERVED_ROUTE_PREFIX_RULE,
    severity: "error",
    file: route.sourceFile,
    line: route.source.line,
    message:
      'Route path "' +
      route.path +
      '" is framework-owned: a project route may not shadow a framework handler (invariant 6).',
    fix_hint:
      "Move the route off the framework path: " +
      why +
      ". App routes stay under the trees the framework does not register (SPEC §8.6, D-215).",
  };
}

/** Rule 23 over the effective analysis (invariant 6, D-215). */
export function reservedRoutePrefixErrors(state: EffectiveState): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const route of state.analysis.routes) {
    const reserved = reservedRoutePathOf(route.path);
    if (reserved !== undefined) errors.push(finding(route, reserved.why));
  }
  return errors;
}
