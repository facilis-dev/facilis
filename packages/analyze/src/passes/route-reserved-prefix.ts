/**
 * D-215 diagnostic: a project route may not shadow a framework-owned path (invariant 6,
 * D-107/D-116/D-120). The route fact carries the path Nitro's file router derives, so the check
 * is facts-only: a path under the framework control plane, the SSO namespace or the token
 * endpoint is an error. A file under `server/{routes,api}/__facilis/**` derives a `/__facilis/**`
 * path, so the file-location rule is the same rule (the gate also asserts the location
 * directly). The framework's own routes are not project route files (they live under
 * `packages/nitro`), so they are never scanned. Additive: the runtime guard remains the
 * authority.
 */

import { error } from "../diagnostics.ts";
import { reservedRoutePathOf } from "../reserved-route-paths.ts";
import type { Diagnostic, RouteFact } from "../types.ts";

export const RESERVED_ROUTE_PREFIX_CODE = "reserved-route-prefix";

const SHADOW_MESSAGE =
  "Route path is framework-owned (SPEC §8.6, invariant 6): a project route may not shadow a framework handler";

/** Diagnostics for every project route that shadows a framework-owned path (D-215). */
export function reservedRoutePrefixDiagnostics(routes: readonly RouteFact[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const route of routes) {
    const reserved = reservedRoutePathOf(route.path);
    if (reserved === undefined) continue;
    diagnostics.push(
      error(
        RESERVED_ROUTE_PREFIX_CODE,
        SHADOW_MESSAGE + '; "' + route.path + '" belongs to ' + reserved.why + ".",
        route.source,
      ),
    );
  }
  return diagnostics;
}
