import type { HTTPEvent } from "nitro";

interface MatchedRoute {
  route?: unknown;
}

/**
 * The matched route TEMPLATE (`/users/:id`), never the concrete path: span attributes are
 * value-free by construction (D-203 §2), so a raw URL must never reach them.
 */
export function matchedRouteTemplate(event: HTTPEvent): string | null {
  const context = event.context as { matchedRoute?: MatchedRoute } | undefined;
  const route = context?.matchedRoute?.route;
  return typeof route === "string" && route.length > 0 ? route : null;
}
