// Cloudflare Pages Function for the git smart-HTTP proxy (D-079).
//
// Pages mounts this file at /git-proxy/**, so the function shares the IDE origin and the
// browser needs no cross-origin request of its own. The handler is deliberately
// stateless; GIT_PROXY_ALLOW only selects the upstream hosts, it is never persisted.

import { createGitProxy, parseAllowedHosts } from "../../git-proxy/handler.mjs";

interface Env {
  GIT_PROXY_ALLOW?: string;
}

/**
 * Pages invokes this for every request under functions/git-proxy. An unset or empty
 * GIT_PROXY_ALLOW means the handler's built-in public-host allowlist.
 */
export function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  return createGitProxy({ allow: parseAllowedHosts(context.env.GIT_PROXY_ALLOW) }).fetch(
    context.request,
  );
}
