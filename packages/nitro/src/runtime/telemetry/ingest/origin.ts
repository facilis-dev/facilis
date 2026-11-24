/**
 * Strict origin allowlist for the ingestion route (spec §8.8): exact scheme + host + port
 * match. `"null"`, a wildcard or a missing Origin is never accepted — the gate exists so a
 * foreign page cannot use the app as an open OTLP relay.
 */
import type { HeaderReader } from "../../http-guard.ts";

export function isAllowedOrigin(
  allowedOrigins: readonly string[],
  origin: string | null,
): boolean {
  if (origin === null || origin === "" || origin === "null" || origin.includes("*")) {
    return false;
  }
  const normalized = origin.replace(/\/$/, "");
  return allowedOrigins.some((allowed) => allowed === normalized);
}

/**
 * The request's own origin, used when the deploy configured no allowlist (the route is then
 * reachable from the app's own origin only, docs/MANAGED-DEPLOYMENT.md §3). Mirrors the SSO
 * resolution: Nitro can hand a path-only URL to the handler, so fall through to the Host
 * header and the proxy's forwarded protocol. Null when neither yields an http(s) origin.
 */
export function requestOrigin(rawUrl: string, headers: HeaderReader): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // Path-only URL: the Host header below is the authority the request actually carried.
  }
  const host = headers.get("host");
  if (host === null || host === "") return null;
  const protocol = headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  try {
    return new URL(protocol + "://" + host).origin;
  } catch {
    return null;
  }
}
