// The transport half of real git over HTTPS: the deployment's stateless proxy
// (D-079), its health probe, and the lazy isomorphic-git loader.
//
// Git hosts send no CORS headers on their smart-HTTP endpoints, so a browser tab
// cannot call them directly. The deployment serves a stateless proxy at
// `<proxyBase>/<host><path>` that forwards to `https://<host><path>`; all this
// module does is translate a remote URL into that proxy URL. Nothing here is
// stateful and no credential is ever placed in a URL — authentication stays in
// the headers isomorphic-git builds from `onAuth` (see git-remote.ts).

import httpWeb from "isomorphic-git/http/web";
import type { AuthCallback, HttpClient } from "isomorphic-git";
import type { GitHttpRequest } from "isomorphic-git/http/web";
import { deployment, gitProxyConfigured } from "@/deploy/current";
import { detectGitProvider } from "./git-provider";

/** The isomorphic-git surface, typed by the real package (no `any`). */
export type GitApi = typeof import("isomorphic-git");

/** A per-call token. Never persisted, never logged, never put in a URL. */
export type Credentials = { token: string; username?: string };

/** The one place the proxy path lives; the deployment may override it later. */
const SAME_ORIGIN_PATH = "/git-proxy";
const PROBE_TIMEOUT_MS = 5000;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Turn the deployment's `projects.gitProxy` value into a usable base URL.
 * `"same-origin"` means the proxy is served by the app itself; an absolute
 * https URL is used as-is. A blank or malformed value means real git is off —
 * the caller must report that, never fall back to a REST endpoint.
 */
export function resolveProxyBase(configured: string | null, origin: string): string | null {
  if (configured === null) return null;
  const value = configured.trim();
  if (value === "") return null;
  if (value === "same-origin") {
    const base = trimTrailingSlashes(origin.trim());
    // A relative page origin is not enough to build an absolute proxy URL.
    return base === "" ? null : base + SAME_ORIGIN_PATH;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // The proxy must itself be HTTPS: an http:// base in an https page is mixed
  // content, and a non-URL is a configuration mistake rather than a feature.
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return trimTrailingSlashes(value);
}

/**
 * Map `https://github.com/o/r.git` to `<base>/github.com/o/r.git`.
 * Query strings are preserved because git's smart-HTTP handshake uses them
 * (`?service=git-upload-pack`). Returns null for anything the proxy cannot
 * carry: non-https, unparseable, or a URL that hides credentials in the
 * userinfo — those must never reach the network.
 */
export function proxyUrlFor(base: string, remoteUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const cleanBase = trimTrailingSlashes(base.trim());
  if (cleanBase === "") return null;
  // `host` keeps a self-hosted port (gitea.local:3000); the proxy forwards
  // the path verbatim, so the original spelling of the path is preserved.
  return `${cleanBase}/${url.host}${url.pathname}${url.search}`;
}

export interface GitHttpClient {
  request: (request: Record<string, unknown> & { url: string }) => Promise<unknown>;
}

/**
 * Wrap isomorphic-git's browser HTTP client so every request goes to the
 * proxy. Only `url` is rewritten; headers, body, abort signal and progress
 * callbacks pass through untouched, which is what keeps the Authorization
 * header (and therefore the token) out of the URL and out of history.
 */
export function createGitHttp(base: string): GitHttpClient {
  return {
    request: async (request) => {
      const url = proxyUrlFor(base, request.url);
      if (url === null) {
        // Do not echo the offending URL: it is attacker-controlled input and
        // may itself contain a credential.
        throw new Error("Git remote URL must be an https:// URL without credentials.");
      }
      const passthrough = request as unknown as GitHttpRequest;
      return httpWeb.request({ ...passthrough, url });
    },
  };
}

/** The deployment's proxy base for this page, or null when git is compiled out. */
export function proxyBase(): string | null {
  const configured = gitProxyConfigured(deployment);
  // The origin only matters for "same-origin"; a bare deployment (no location)
  // resolves to null there and the UI reports git as unavailable.
  const origin = typeof location === "undefined" ? "" : location.origin;
  return resolveProxyBase(configured, origin);
}

/** Ask the proxy whether it is alive. Never carries a credential. */
export async function probeProxy(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(trimTrailingSlashes(base) + "/health", {
      method: "GET",
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    });
    return response.status === 200 || response.status === 204;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ── auth (per call, never persisted) ──

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Default basic-auth usernames the hosts accept for a token as the password. */
export function defaultUsername(host: string): string {
  const provider = detectGitProvider(host);
  if (provider === "github") return "x-access-token";
  if (provider === "gitlab") return "oauth2";
  return "git";
}

/**
 * Build isomorphic-git's `onAuth`. The callback is invoked with the remote URL
 * after a 401; the token is returned as the password so isomorphic-git turns it
 * into an Authorization header. Returning undefined for a different host means
 * a redirect can never receive the credential.
 */
export function authCallback(url: string, credentials?: Credentials): AuthCallback | undefined {
  if (!credentials) return undefined;
  const host = hostOf(url);
  if (host === "") return undefined;
  const username = credentials.username ?? defaultUsername(host);
  return (requestUrl) => {
    if (hostOf(requestUrl) !== host) return undefined;
    return { username, password: credentials.token };
  };
}

// ── error handling shared with the git operations ──

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strip the token from anything we are about to show or throw. */
export function redact(message: string, token?: string): string {
  if (!token) return message;
  return message.split(token).join("[redacted]");
}

/** Run one network op and re-throw with the token redacted (cause kept). */
export async function guarded<T>(
  credentials: Credentials | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(redact(errorText(err), credentials?.token), { cause: err });
  }
}

// ── lazy git loading (Buffer first, then the ~1 MB chunk) ──

let bufferReady: Promise<void> | null = null;
function ensureBuffer(): Promise<void> {
  const global = globalThis as { Buffer?: unknown };
  if (global.Buffer) return Promise.resolve();
  if (!bufferReady) {
    bufferReady = import("buffer").then(({ Buffer }) => {
      if (!global.Buffer) global.Buffer = Buffer;
    });
  }
  return bufferReady;
}

let gitModule: Promise<GitApi> | null = null;

/** Load isomorphic-git on first network use, never at boot. */
export function loadGit(): Promise<GitApi> {
  if (!gitModule) {
    // The polyfill must exist BEFORE the chunk evaluates its Buffer references.
    gitModule = ensureBuffer().then(() => import("isomorphic-git"));
  }
  return gitModule;
}

/** The branch an empty remote expects: its advertised HEAD, else the modern default. */
export function branchForEmptyRemote(head: unknown): string {
  if (typeof head !== "string") return "main";
  const prefix = "refs/heads/";
  return head.startsWith(prefix) && head.length > prefix.length
    ? head.slice(prefix.length)
    : "main";
}

/**
 * The branch to initialise when the remote advertises NO refs at all — a brand-new
 * repository — else null. Cloning such a remote leaves nothing to check out, so the
 * caller initialises git locally instead and can scaffold the project (D-080).
 */
export async function emptyRemoteBranch(
  git: GitApi,
  http: HttpClient,
  url: string,
  credentials?: Credentials,
): Promise<string | null> {
  const info = await git.getRemoteInfo({ http, url, onAuth: authCallback(url, credentials) });
  if (Object.keys(info.refs ?? {}).length > 0) return null;
  return branchForEmptyRemote(info.HEAD);
}
