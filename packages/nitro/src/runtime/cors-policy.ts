import type { RouteMetadata, RouteMetadataMap } from "../types.ts";

/**
 * CORS policy for the runtime middleware (SPEC §8).
 *
 * Pure on purpose: it owns the OpenAPI-path matcher and the header/preflight decisions, so
 * the middleware is only wiring and the rules stay unit-testable without virtual modules.
 */

/** Compiled path templates, cached: every request would otherwise recompile the route table. */
const PATH_PATTERNS = new Map<string, RegExp>();

const PARAM_SEGMENT = /^\{[^}]+\}$/;
const CATCH_ALL_SEGMENT = /^\{\*[^}]+\}$/;
const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const DEFAULT_ALLOW_HEADERS = "content-type";
const PREFLIGHT_MAX_AGE = "600";

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A {name} segment matches one segment, a {*rest} segment matches the remainder. */
function compilePattern(template: string): RegExp {
  const cached = PATH_PATTERNS.get(template);
  if (cached !== undefined) return cached;
  const pattern = template
    .split("/")
    .map((segment) => {
      if (CATCH_ALL_SEGMENT.test(segment)) return ".*";
      if (PARAM_SEGMENT.test(segment)) return "[^/]+";
      return escapeSegment(segment);
    })
    .join("/");
  const compiled = new RegExp("^" + pattern + "$");
  PATH_PATTERNS.set(template, compiled);
  return compiled;
}

/** The route whose OpenAPI path template matches the request path and method, if any. */
export function matchRoute(
  metadata: RouteMetadataMap,
  pathname: string,
  method: string,
): RouteMetadata | undefined {
  const normalizedMethod = method.toLowerCase();
  for (const [template, operations] of Object.entries(metadata)) {
    if (!compilePattern(template).test(pathname)) continue;
    const route = operations[normalizedMethod];
    if (route !== undefined) return route;
  }
  return undefined;
}

/**
 * Headers for a non-preflight response. A crossSite route answers every origin with "*"
 * and no credentials; a trusted origin gets an exact echo plus credentials. Nothing else
 * may be exposed, so an untrusted origin receives no CORS header at all.
 */
export function corsHeadersFor(
  origin: string | null,
  trusted: boolean,
  route: RouteMetadata | undefined,
): Headers {
  const headers = new Headers();
  if (route?.crossSite === true) {
    headers.set("access-control-allow-origin", "*");
    return headers;
  }
  if (!trusted || origin === null) return headers;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "origin");
  return headers;
}

/**
 * Preflight answer, or null when the request is not a CORS preflight the policy allows.
 *
 * The caller gates on the OPTIONS method; this function only needs the headers, because a
 * missing access-control-request-method is what distinguishes a plain OPTIONS request.
 */
export function preflightResponse(
  metadata: RouteMetadataMap,
  pathname: string,
  requestHeaders: Headers,
  trustedOrigins: readonly string[],
): Response | null {
  const requestedMethod = requestHeaders.get("access-control-request-method");
  if (requestedMethod === null) return null;

  const origin = requestHeaders.get("origin");
  const trusted = origin !== null && trustedOrigins.includes(origin);
  const route = matchRoute(metadata, pathname, requestedMethod);
  const headers = corsHeadersFor(origin, trusted, route);
  if (!headers.has("access-control-allow-origin")) return null;

  headers.set("access-control-allow-methods", ALLOW_METHODS);
  headers.set(
    "access-control-allow-headers",
    requestHeaders.get("access-control-request-headers") ?? DEFAULT_ALLOW_HEADERS,
  );
  headers.set("access-control-max-age", PREFLIGHT_MAX_AGE);
  return new Response(null, { status: 204, headers });
}
