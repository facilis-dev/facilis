// Types for the stateless git proxy handler (D-079, D-208). The implementation is .mjs so
// the same file runs in Cloudflare Workers, Node and Vite's dev server; this declaration is
// what the TypeScript wrappers (Pages Function, dev middleware, standalone server) see.

export declare const DEFAULT_ALLOWED_HOSTS: string[];

export declare function parseAllowedHosts(value?: string | null): string[];

/** Re-exported from caller.mjs: a deployment's GIT_PROXY_ALLOWED_ORIGINS, normalized. */
export declare function parseOrigins(value?: string | null): string[];

/** Re-exported from caller.mjs: GIT_PROXY_REQUIRE_AUTH, as an explicit positive. */
export declare function parseRequireAuth(value?: string | null): boolean;

export type GitProxyFetch = (request: Request) => Promise<Response>;

export interface GitProxyOptions {
  allow?: readonly string[];
  /** Extra browser origins; the deployment's own host is always allowed. */
  allowedOrigins?: readonly string[];
  /** Demand an Authorization header on the git endpoints (not on a host's login). */
  requireAuthorization?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GitProxy {
  fetch: GitProxyFetch;
}

export declare function createGitProxy(options?: GitProxyOptions): GitProxy;
