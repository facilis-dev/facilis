// Caller policy for the git proxy (D-208).
//
// The proxy cannot authenticate a caller: the IDE is a static SPA, so there is no session
// to check. What it can do is bound the browser — a page may only use the proxy from the
// deployment's own host, or from an origin the operator names — and let a deployment
// demand a token for git traffic. Everything here is pure: no fetch, no state, so it runs
// unchanged in Workers, Node and Vite's dev server.

/**
 * `scheme://host[:port]`, lowercase; null for junk, for `Origin: null` (a sandboxed frame
 * or file:) and for a wildcard. An Origin header is an origin, never a URL with userinfo.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeOrigin(value) {
  if (typeof value !== "string") return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.origin.toLowerCase();
}

/**
 * A deployment's comma-separated origin list, normalized and deduplicated. Entries that
 * are not http(s) origins are dropped: there is no wildcard and no "any origin".
 *
 * @param {string | null | undefined} [value]
 * @returns {string[]}
 */
export function parseOrigins(value) {
  /** @type {string[]} */
  const origins = [];
  for (const part of (typeof value === "string" ? value : "").split(",")) {
    const origin = normalizeOrigin(part);
    if (origin !== null && !origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * The set the request check reads, from the same values `parseOrigins` accepts.
 *
 * @param {readonly unknown[] | null | undefined} values
 * @returns {Set<string>}
 */
export function originSet(values) {
  const origins = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const origin = normalizeOrigin(String(value));
    if (origin !== null) origins.add(origin);
  }
  return origins;
}

/** Env and CLI flags arrive as strings; only an explicit positive is on. */
export function parseRequireAuth(value) {
  const flag = typeof value === "string" ? value.trim().toLowerCase() : "";
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

// Git's own endpoints. Only these demand a token when require-auth is on: a host's login
// endpoints are how the client obtains that token in the first place.
const GIT_ENDPOINT_SUFFIXES = ["/info/refs", "/git-upload-pack", "/git-receive-pack"];

/** The endpoint suffix test; an odd spelling fails closed (auth), not open. */
export function isGitEndpoint(path) {
  const lower = path.toLowerCase();
  return GIT_ENDPOINT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Decide whether a request's Origin may use the proxy. Same-origin compares host and port
 * and ignores the scheme, because a TLS-terminating reverse proxy hands the handler an
 * http:// request URL. A request without an Origin header is not a browser (native git, the
 * availability probe) and has no origin to check.
 *
 * @param {string | null} originHeader
 * @param {URL} requestUrl
 * @param {ReadonlySet<string>} allowedOrigins
 * @returns {{ allowed: true, origin: string | null } | { allowed: false }}
 */
export function callerOrigin(originHeader, requestUrl, allowedOrigins) {
  if (originHeader === null) return { allowed: true, origin: null };
  const origin = normalizeOrigin(originHeader);
  if (origin === null) return { allowed: false };
  if (new URL(origin).host === requestUrl.host) return { allowed: true, origin };
  if (allowedOrigins.has(origin)) return { allowed: true, origin };
  return { allowed: false };
}
