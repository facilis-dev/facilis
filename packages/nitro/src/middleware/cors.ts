import type { H3Event } from "nitro";
import { getRequestHeader, setResponseHeader } from "nitro/h3";
import config from "#facilis/config";
import routeMetadata from "#facilis/openapi-meta";

import { corsHeadersFor, matchRoute, preflightResponse } from "../runtime/cors-policy.ts";

/** Trusted origins come from security.trustedOrigins; anything malformed is ignored. */
function readTrustedOrigins(source: unknown): readonly string[] {
  const security = (source as { security?: { trustedOrigins?: unknown } }).security;
  const origins = security?.trustedOrigins;
  if (!Array.isArray(origins)) return [];
  return origins.filter((origin): origin is string => typeof origin === "string");
}

const TRUSTED_ORIGINS = readTrustedOrigins(config);

/**
 * facilis-cors middleware (SPEC §8).
 *
 * Runs before facilis-context so a preflight is answered without booting the db or auth.
 * A returned Response short-circuits the request; otherwise the CORS headers are set on the
 * response the route will produce.
 */
const handler = (event: H3Event): Response | undefined => {
  const pathname = new URL(event.req.url, "http://localhost").pathname;
  const method = (event.req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS") {
    return (
      preflightResponse(routeMetadata, pathname, event.req.headers, TRUSTED_ORIGINS) ?? undefined
    );
  }

  const origin = getRequestHeader(event, "origin") ?? null;
  const trusted = origin !== null && TRUSTED_ORIGINS.includes(origin);
  const headers = corsHeadersFor(origin, trusted, matchRoute(routeMetadata, pathname, method));
  for (const [name, value] of headers) setResponseHeader(event, name, value);
  return undefined;
};

export default handler;
