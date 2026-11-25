// Cloudflare Pages Function for the git smart-HTTP proxy (D-079, D-208).
//
// Pages mounts this file at /git-proxy/**, so the function shares the IDE origin and the
// browser needs no cross-origin request of its own. The handler is deliberately stateless;
// the environment only configures what it accepts, and nothing is persisted.

import {
  createGitProxy,
  parseAllowedHosts,
  parseOrigins,
  parseRequireAuth,
} from "../../git-proxy/handler.mjs";

interface Env {
  /** Upstream hosts; unset means the handler's built-in public allowlist. */
  GIT_PROXY_ALLOW?: string;
  /** Extra browser origins; unset means this deployment's own host only. */
  GIT_PROXY_ALLOWED_ORIGINS?: string;
  /** Unset requires a token on git traffic; "0"/"false" allows anonymous public clones. */
  GIT_PROXY_REQUIRE_AUTH?: string;
}

/**
 * Pages invokes this for every request under functions/git-proxy, so the same-origin rule
 * needs no configuration: the deployment's own host is always the caller.
 */
export function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  return createGitProxy({
    allow: parseAllowedHosts(context.env.GIT_PROXY_ALLOW),
    allowedOrigins: parseOrigins(context.env.GIT_PROXY_ALLOWED_ORIGINS),
    requireAuthorization: parseRequireAuth(context.env.GIT_PROXY_REQUIRE_AUTH),
  }).fetch(context.request);
}
