/**
 * Request-origin gate for `defineAuthorizedHandler` (SPEC §8, CSRF defence).
 *
 * The session travels in a `facilis_session` cookie, so an unsafe request is only trusted when
 * the browser says it came from this origin or the config allow-lists it. The decision is
 * structural: no route opts out, and every route is covered by the same wrapper check.
 */

const UNSAFE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestOriginPolicy {
  readonly method?: string;
  readonly headers: Headers;
  /** Absolute origins allowed to make unsafe requests besides the request's own origin. */
  readonly trustedOrigins: readonly string[];
  /** The route is callable from another origin without credentials; skips the check. */
  readonly crossSite: boolean;
}

/** Safe (and unknown) methods cannot change state, so they never need an origin check. */
export function isUnsafeMethod(method: string | undefined): boolean {
  return method !== undefined && UNSAFE_METHODS.has(method.toUpperCase());
}

function normalizedOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

/** An allow-list entry that does not parse as an origin simply never matches. */
function isTrustedOrigin(origin: string, trustedOrigins: readonly string[]): boolean {
  // The literal "null" is an opaque origin (sandboxed frame, file://): never trustable.
  if (origin === "null") return false;
  const normalized = normalizedOrigin(origin);
  if (normalized === undefined) return false;
  return trustedOrigins.some((trusted) => normalizedOrigin(trusted) === normalized);
}

/**
 * Without `Sec-Fetch-Site` (older browsers, non-browser clients) the `Origin` header is the
 * only evidence left; a matching `Host` corroborates that it belongs to this deployment.
 */
function isSameOriginByHeader(policy: RequestOriginPolicy, origin: string): boolean {
  if (origin === "null") return false;
  if (isTrustedOrigin(origin, policy.trustedOrigins)) return true;
  const host = policy.headers.get("host");
  if (host === null) return false;
  const originHost = hostOf(origin);
  const requestHost = hostOf(`http://${host.trim()}`);
  return originHost !== undefined && originHost === requestHost;
}

export function isRequestOriginAllowed(policy: RequestOriginPolicy): boolean {
  if (!isUnsafeMethod(policy.method)) return true;
  if (policy.crossSite) return true;

  const fetchSite = policy.headers.get("sec-fetch-site")?.trim().toLowerCase();
  switch (fetchSite) {
    case "same-origin":
    case "none":
      // The browser states this origin (or no initiator) made the request.
      return true;
    case "same-site": {
      // A sibling subdomain is not this origin: only an explicit allow-list entry passes.
      const origin = policy.headers.get("origin")?.trim();
      return (
        origin !== undefined && origin.length > 0 && isTrustedOrigin(origin, policy.trustedOrigins)
      );
    }
    case "cross-site":
      return false;
    default:
      break;
  }

  // An absent or unknown `Sec-Fetch-Site` falls back to `Origin`; a request that carries
  // neither is a non-browser client, which a browser cannot forge.
  const origin = policy.headers.get("origin")?.trim();
  if (origin === undefined || origin.length === 0) return true;
  return isSameOriginByHeader(policy, origin);
}
