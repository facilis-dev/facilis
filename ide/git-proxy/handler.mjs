// Git smart-HTTP pass-through proxy (D-079).
//
// Git hosts send no CORS headers on their smart-HTTP endpoints, so a browser tab cannot
// call them directly. This handler is the server side of that bridge and nothing else:
// stateless, logging-free, storage-free. The Authorization header and the query string
// only transit it; they must never end up in a response. Do not add console.*, a cache,
// analytics, or code that reads the request body: git packs are tens of megabytes, and
// buffering one would break streaming and exhaust memory.

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

// CORS is always added: the Pages Function is same-origin, but a self-hosted Node server
// may be put behind a different origin, and the browser availability probe must be able
// to read the response either way.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, user-agent, git-protocol",
  "access-control-expose-headers": "content-type",
  "x-content-type-options": "nosniff",
};

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

/** @returns {Headers} */
function responseHeaders() {
  return new Headers({ ...CORS_HEADERS, "cache-control": "no-store" });
}

/**
 * @param {number} status
 * @param {string} message
 * @returns {Response}
 */
function textResponse(status, message) {
  const headers = responseHeaders();
  headers.set("content-type", "text/plain");
  return new Response(message, { status, headers });
}

/** @returns {Response} */
function emptyResponse() {
  return new Response(null, { status: 204, headers: responseHeaders() });
}

/**
 * @typedef {(request: Request) => Promise<Response>} GitProxyFetch
 */

/**
 * Build the proxy. `fetchImpl` is a seam for tests and for runtimes without a global
 * fetch; production callers omit it.
 *
 * @param {{ allow?: readonly string[], fetchImpl?: typeof fetch }} [options]
 * @returns {{ fetch: GitProxyFetch }}
 */
export function createGitProxy({
  allow = DEFAULT_ALLOWED_HOSTS,
  fetchImpl = globalThis.fetch,
} = {}) {
  // Lowercase here too: the handler matches exactly, and a caller passing the raw env
  // value must not accidentally get a case-sensitive allowlist.
  const allowSet = new Set(
    (Array.isArray(allow) ? allow : [])
      .map((host) => String(host).trim().toLowerCase())
      .filter((host) => host !== ""),
  );

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

      const route = parseRoute(url);
      if (route.kind === "health") {
        // GET/HEAD are the documented availability probe; OPTIONS serves its preflight.
        return method === "POST" ? textResponse(405, "method not allowed") : emptyResponse();
      }
      if (route.kind === "miss") return textResponse(404, "not found");

      if (!isValidHostEntry(route.host) || !allowSet.has(route.host)) {
        return textResponse(403, "host not allowed");
      }
      if (method === "OPTIONS") return emptyResponse();

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
        return textResponse(502, "git proxy: upstream request failed");
      }

      // Copying only content-type is how every other upstream header (set-cookie,
      // content-encoding, content-length, transfer-encoding, ...) is stripped.
      const headersOut = responseHeaders();
      const contentType = upstream.headers.get("content-type");
      if (contentType !== null) headersOut.set("content-type", contentType);
      const body = NO_BODY_STATUS.has(upstream.status) ? null : upstream.body;
      return new Response(body, { status: upstream.status, headers: headersOut });
    },
  };
}
