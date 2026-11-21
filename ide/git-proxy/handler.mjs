// Git smart-HTTP pass-through proxy (D-079).
//
// Git hosts send no CORS headers on their smart-HTTP endpoints, so a browser tab cannot
// call them directly. This handler is the server side of that bridge and nothing else:
// stateless, logging-free, storage-free. The Authorization header and the query string
// only transit it; they must never end up in a response. Do not add console.*, a cache,
// analytics, or code that reads the request body: git packs are tens of megabytes, and
// buffering one would break streaming and exhaust memory.
//
// The caller is bounded, not identified (D-208): a browser may only call it from the
// deployment's own host or from an origin the operator names, and git traffic needs an
// Authorization header unless the deployment opts out — the host verifies that token, not
// this file. Rate limiting is the edge's job, never this file's — that is what keeps the
// handler stateless.

import { callerOrigin, isGitEndpoint, originSet } from "./caller.mjs";

export { parseOrigins, parseRequireAuth } from "./caller.mjs";

export const DEFAULT_ALLOWED_HOSTS = ["github.com", "gitlab.com", "gitea.com", "codeberg.org"];

const ROUTE_PREFIX = "/git-proxy";
const HEALTH_PATH = `${ROUTE_PREFIX}/health`;

// The complete set of inbound headers worth forwarding. Everything else (host, origin,
// referer, cookie, x-forwarded-*, accept-encoding, ...) is dropped, so the upstream
// cannot learn anything about the tab or this deployment.
const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "user-agent",
  "git-protocol",
];

// CORS is echoed for the caller's own origin, never '*': a deployment behind a different
// origin needs it, and a response must not be readable by a page that is not the caller.
const ALLOWED_METHODS = "GET, HEAD, POST, OPTIONS";
const CORS_ALLOWED_HEADERS = "authorization, content-type, accept, user-agent, git-protocol";
const CORS_EXPOSED_HEADERS = "content-type";

// Response constructor throws when one of these carries a body.
const NO_BODY_STATUS = new Set([204, 205, 304]);

// Hostname (single-label hosts such as localhost are fine) plus an optional port.
// Conservative on purpose: exact allowlist matching is the security boundary, and this
// keeps userinfo (@), wildcards, percent escapes and path separators out of the host
// segment before the upstream URL is assembled.
const HOST_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidHostEntry(value) {
  if (!HOST_PATTERN.test(value)) return false;
  const colon = value.lastIndexOf(":");
  if (colon === -1) return true;
  const port = Number(value.slice(colon + 1));
  return port >= 1 && port <= 65535;
}

/**
 * Turn a deployment's GIT_PROXY_ALLOW string into a canonical allowlist.
 * "github.com, https://git.acme.example" -> ["github.com", "git.acme.example"].
 * Empty or all-junk input falls back to the known public defaults, never to an
 * arbitrary host.
 *
 * @param {string | null | undefined} [value]
 * @returns {string[]}
 */
export function parseAllowedHosts(value) {
  /** @type {string[]} */
  const hosts = [];
  const input = typeof value === "string" ? value : "";
  for (const part of input.split(",")) {
    let host = part.trim().toLowerCase();
    if (host.startsWith("https://")) host = host.slice("https://".length);
    if (host === "" || host.includes("/") || /\s/.test(host)) continue;
    if (!isValidHostEntry(host)) continue;
    hosts.push(host);
  }
  return hosts.length > 0 ? hosts : [...DEFAULT_ALLOWED_HOSTS];
}

/**
 * @typedef {{ kind: "health" }
 *   | { kind: "forward", host: string, path: string, search: string }
 *   | { kind: "miss" }} Route
 */

/**
 * @param {URL} url
 * @returns {Route}
 */
function parseRoute(url) {
  if (url.pathname === HEALTH_PATH) return { kind: "health" };
  if (!url.pathname.startsWith(`${ROUTE_PREFIX}/`)) return { kind: "miss" };
  const rest = url.pathname.slice(ROUTE_PREFIX.length + 1);
  const slash = rest.indexOf("/");
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  if (host === "") return { kind: "miss" };
  return {
    kind: "forward",
    host,
    path: slash === -1 ? "" : rest.slice(slash),
    search: url.search,
  };
}

/**
 * @param {string | null} origin  the request's own origin when it sent one and it was allowed
 * @returns {Headers}
 */
function responseHeaders(origin = null) {
  const headers = new Headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" });
  // Echo, never '*': only the origin that sent the request may read the response, and a
  // request without an Origin header (a native git client) does not need CORS at all.
  if (origin !== null) {
    headers.set("vary", "origin");
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", ALLOWED_METHODS);
    headers.set("access-control-allow-headers", CORS_ALLOWED_HEADERS);
    headers.set("access-control-expose-headers", CORS_EXPOSED_HEADERS);
  }
  return headers;
}

/**
 * @param {number} status
 * @param {string} message
 * @param {string | null} [origin]
 * @param {Record<string, string>} [extra]
 * @returns {Response}
 */
function textResponse(status, message, origin = null, extra = {}) {
  const headers = responseHeaders(origin);
  headers.set("content-type", "text/plain");
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(message, { status, headers });
}

/**
 * @param {string | null} [origin]
 * @returns {Response}
 */
function emptyResponse(origin = null) {
  return new Response(null, { status: 204, headers: responseHeaders(origin) });
}

/**
 * @typedef {(request: Request) => Promise<Response>} GitProxyFetch
 */

/**
 * Build the proxy.
 *
 * `allowedOrigins` are extra origins a browser may call it from; the deployment's own host
 * is always allowed, and a request that sends no Origin header is not a browser and passes
 * (see the fetch body). `requireAuthorization` demands an Authorization header on the git
 * endpoints, which removes anonymous traffic without breaking the login that produces the
 * token; it is on unless a deployment opts out to keep anonymous public clones.
 * `fetchImpl` is a seam for tests and for runtimes without a global fetch.
 *
 * @param {{
 *   allow?: readonly string[],
 *   allowedOrigins?: readonly string[],
 *   requireAuthorization?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 * @returns {{ fetch: GitProxyFetch }}
 */
export function createGitProxy({
  allow = DEFAULT_ALLOWED_HOSTS,
  allowedOrigins = [],
  requireAuthorization = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Lowercase here too: the handler matches exactly, and a caller passing the raw env
  // value must not accidentally get a case-sensitive allowlist.
  const allowSet = new Set(
    (Array.isArray(allow) ? allow : [])
      .map((host) => String(host).trim().toLowerCase())
      .filter((host) => host !== ""),
  );
  const permittedOrigins = originSet(allowedOrigins);

  return {
    /** @param {Request} request */
    async fetch(request) {
      const method = request.method.toUpperCase();
      if (!["GET", "HEAD", "POST", "OPTIONS"].includes(method)) {
        return textResponse(405, "method not allowed");
      }

      let url;
      try {
        url = new URL(request.url);
      } catch {
        return textResponse(400, "invalid request url");
      }

      // Caller check (D-208): a browser may only use the proxy from the deployment's own
      // host or an allowed origin; no Origin header is not a browser, and the host
      // allowlist below still bounds what it can reach.
      const caller = callerOrigin(request.headers.get("origin"), url, permittedOrigins);
      if (!caller.allowed) {
        // No CORS headers on purpose: the browser must not read even this answer.
        return textResponse(403, "origin not allowed");
      }
      const origin = caller.origin;

      const route = parseRoute(url);
      if (route.kind === "health") {
        // GET/HEAD are the documented availability probe; OPTIONS serves its preflight.
        return method === "POST"
          ? textResponse(405, "method not allowed", origin)
          : emptyResponse(origin);
      }
      if (route.kind === "miss") return textResponse(404, "not found", origin);

      if (!isValidHostEntry(route.host) || !allowSet.has(route.host)) {
        return textResponse(403, "host not allowed", origin);
      }
      // Preflight first: it carries no Authorization header, so a 401 here would stop the
      // real request before the browser ever sent it.
      if (method === "OPTIONS") return emptyResponse(origin);
      if (
        requireAuthorization &&
        isGitEndpoint(route.path) &&
        request.headers.get("authorization") === null
      ) {
        return textResponse(401, "authorization required", origin, {
          "www-authenticate": 'Basic realm="git-proxy"',
        });
      }

      // Only the allowlisted host and the path/query portion of the incoming URL feed the
      // upstream URL. Concatenation (rather than new URL(path, base)) keeps a path such as
      // "//other.host/x" from being interpreted as a replacement authority.
      const upstreamUrl = `https://${route.host}${route.path}${route.search}`;
      const headers = new Headers();
      for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
      }

      let upstream;
      try {
        // request.body is passed through as a stream: the proxy never calls .text(),
        // .arrayBuffer() or .json() on the request, so a pack is never buffered here.
        upstream = await fetchImpl(upstreamUrl, {
          method,
          headers,
          body: request.body,
          duplex: "half",
          signal: request.signal,
        });
      } catch {
        // Deliberately opaque: an upstream error can carry a URL, a token in the query
        // string or an internal address, and this proxy must not log or leak any of it.
        return textResponse(502, "git proxy: upstream request failed", origin);
      }

      // Copying only content-type is how every other upstream header (set-cookie,
      // content-encoding, content-length, transfer-encoding, ...) is stripped.
      const headersOut = responseHeaders(origin);
      const contentType = upstream.headers.get("content-type");
      if (contentType !== null) headersOut.set("content-type", contentType);
      const body = NO_BODY_STATUS.has(upstream.status) ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: headersOut });
    },
  };
}
