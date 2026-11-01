// Types for the stateless git proxy handler (D-079). The implementation is .mjs so the
// same file runs in Cloudflare Workers, Node and Vite's dev server; this declaration is
// what the TypeScript wrappers (Pages Function, dev middleware, standalone server) see.

export declare const DEFAULT_ALLOWED_HOSTS: string[];

export declare function parseAllowedHosts(value?: string | null): string[];

export type GitProxyFetch = (request: Request) => Promise<Response>;

export interface GitProxyOptions {
  allow?: readonly string[];
  fetchImpl?: typeof fetch;
}

export interface GitProxy {
  fetch: GitProxyFetch;
}

export declare function createGitProxy(options?: GitProxyOptions): GitProxy;
