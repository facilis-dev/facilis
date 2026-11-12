// The web tools' reach: which origins the chat may read from the public web (D-175).
//
// The decision belongs to the compiled deployment, never to the model or the UI. An open
// build reaches any HTTPS host; a managed build only the origins its administrator already
// declared in `network.connect` — the same list the managed CSP uses for connect-src, so
// the policy and the browser's own block cannot drift apart. Managed with nothing declared
// has no web family at all (null), which keeps the default zero-egress.
//
// Pure URL parsing: no DOM, no fetch, so the policy is unit-tested and the chat host can
// check a URL before it leaves the browser.

import type { ResolvedDeployment } from "./types.ts";

export type WebPolicy =
  { readonly kind: "open" } | { readonly kind: "hosts"; readonly origins: readonly string[] };

/** The origins `network.connect` names, reduced and deduped; invalid entries are dropped. */
function configuredOrigins(deployment: ResolvedDeployment): string[] {
  const origins: string[] = [];
  for (const entry of deployment.network.connect) {
    try {
      const origin = new URL(entry).origin;
      // "null" is the opaque origin of a non-hierarchical URL, which cannot be compared to
      // a page origin; it names no reachable HTTPS host, so it is not a usable entry.
      if (origin !== "null" && !origins.includes(origin)) origins.push(origin);
    } catch {
      // A malformed entry names no origin. resolve.ts already rejects the syntax it sees;
      // dropping it here keeps the runtime fail-closed instead of guessing.
    }
  }
  return origins;
}

/** The compiled web policy, or null when this build has no web family. */
export function webAccessFor(deployment: ResolvedDeployment): WebPolicy | null {
  if (deployment.profile === "open") return { kind: "open" };
  const origins = configuredOrigins(deployment);
  // Managed and nothing declared is "no egress", not "empty allowlist": no tools exist.
  return origins.length === 0 ? null : { kind: "hosts", origins };
}

export type WebUrlDecision = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * The one URL policy: absolute, HTTPS (or plain HTTP on the IDE's own origin), no embedded
 * credentials, and — for a managed build — an origin the deployment declared. A refusal is
 * a string reason so the tool layer can report exactly which rule rejected the URL.
 */
export function webUrlAllowed(
  policy: WebPolicy,
  rawUrl: string,
  pageOrigin: string,
): WebUrlDecision {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "not an absolute URL" };
  }
  // Only the secure web, plus the IDE's own origin over plain http (local development).
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.origin === pageOrigin)) {
    return {
      ok: false,
      reason: "only https URLs are allowed (http only on the IDE's own origin)",
    };
  }
  // Userinfo in a URL is a phishing/exfiltration shape and is never needed for a read.
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URLs must not embed a username or password" };
  }
  if (
    policy.kind === "hosts" &&
    url.origin !== pageOrigin &&
    !policy.origins.includes(url.origin)
  ) {
    return {
      ok: false,
      reason: "host is not allowed by this deployment (network.connect): " + url.origin,
    };
  }
  return { ok: true, url };
}
