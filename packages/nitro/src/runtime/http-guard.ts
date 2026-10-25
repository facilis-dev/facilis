import { isProductionEnvironment } from "./env.ts";
import { jsonResult, type HttpResult } from "./http.ts";

/** Structural header reader: H3Event.req.headers and Headers both satisfy it. */
export interface HeaderReader {
  get(name: string): string | null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEV_HEADERS = { "cache-control": "no-cache" } as const;

/**
 * SPEC §6.8/§8.5 origin allowlist: the request must come from the page the dev
 * server serves. Browsers omit Origin on same-origin GETs, so a missing Origin is
 * allowed; anything present must be loopback or the request host itself.
 */
export function isOriginAllowed(headers: HeaderReader): boolean {
  const origin = headers.get("origin");
  if (origin === null || origin === "") return true;
  if (origin === "null") return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;
  if (LOOPBACK_HOSTNAMES.has(originUrl.hostname)) return true;

  const host = headers.get("host");
  return host !== null && host !== "" && originUrl.host === host;
}

/**
 * Guard a dev-only endpoint. Returns the error response to short-circuit with, or
 * null when the request may proceed (404 in production, 403 on origin mismatch).
 */
export function guardDevRequest(
  headers: HeaderReader,
  environment: NodeJS.ProcessEnv = process.env,
): HttpResult | null {
  if (isProductionEnvironment(environment)) {
    return jsonResult(404, { code: "not_found" }, { ...DEV_HEADERS });
  }
  if (!isOriginAllowed(headers)) {
    return jsonResult(403, { code: "forbidden" }, { ...DEV_HEADERS });
  }
  return null;
}
