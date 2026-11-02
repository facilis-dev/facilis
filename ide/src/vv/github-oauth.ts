// GitHub OAuth device flow (D-082): sign in with a GitHub account, including 2FA,
// without a pasted token and without a client secret.
//
// A static SPA cannot run the authorization-code flow for GitHub: the code exchange
// needs the app's client secret. The device flow is the public-client flow GitHub
// documents instead; the user enters a short code on github.com, and this module polls
// for the access token. GitHub sends no CORS headers on these endpoints, so the calls
// go through the same stateless proxy as git (D-079).
//
// The token never leaves this tab: the session store below is module memory, not
// storage. Nothing here logs, and every error is a code, never a response body.

export type GitHubOAuthErrorCode =
  "cancelled" | "network" | "denied" | "expired" | "invalid" | "unavailable";

/** A sign-in failure the UI can translate; the message never carries a secret. */
export class GitHubOAuthError extends Error {
  readonly code: GitHubOAuthErrorCode;

  constructor(code: GitHubOAuthErrorCode) {
    super("GitHub sign-in failed: " + code);
    this.name = "GitHubOAuthError";
    this.code = code;
  }
}

export interface GitHubDeviceCode {
  userCode: string;
  verificationUri: string;
}

export interface GitHubSignInOptions {
  /** The deployment's proxy base, e.g. https://ide.example/git-proxy. */
  base: string;
  /** The OAuth app's public client id. */
  clientId: string;
  /** Called once, before polling starts, with the code to show the user. */
  onCode: (code: GitHubDeviceCode) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Test seam: production uses an abortable timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEVICE_CODE_PATH = "/github.com/login/device/code";
const ACCESS_TOKEN_PATH = "/github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_VERIFICATION_URI = "https://github.com/login/device";
/** GitHub's scopes are coarse: repo is what clone/push of a private repository needs. */
const SCOPE = "repo";
const MIN_INTERVAL_MS = 1000;
const SLOW_DOWN_MS = 5000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A numeric field from the payload, or 0 when it is absent or not a number. */
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The proxy base must be an http(s) URL; dev serves it from http://localhost. */
function endpoint(base: string, path: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GitHubOAuthError("unavailable");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GitHubOAuthError("unavailable");
  }
  return trimmed + path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** GitHub answers JSON with Accept: application/json; the form fallback is harmless. */
async function readPayload(response: Response): Promise<Record<string, unknown>> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new GitHubOAuthError("network");
  }
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  const record: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(trimmed)) record[key] = value;
  return record;
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
      credentials: "omit",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new GitHubOAuthError("cancelled");
    }
    throw new GitHubOAuthError("network");
  }
}

/** Only GitHub's own HTTPS verification page is offered, never a payload-supplied URL. */
function verificationUri(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "github.com") return url.toString();
  } catch {
    // Fall through to the documented page.
  }
  return DEFAULT_VERIFICATION_URI;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GitHubOAuthError("cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GitHubOAuthError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run the whole device flow: request a code, hand it to the UI, then poll until the
 * user authorizes it, denies it, or the code expires. Resolves with the access token.
 */
export async function signInWithGitHub(options: GitHubSignInOptions): Promise<string> {
  const { clientId, onCode, signal } = options;
  if (clientId.trim() === "") throw new GitHubOAuthError("unavailable");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = (ms: number) =>
    options.sleepImpl ? options.sleepImpl(ms) : abortableSleep(ms, signal);

  const deviceResponse = await postForm(
    endpoint(options.base, DEVICE_CODE_PATH),
    { client_id: clientId, scope: SCOPE },
    signal,
    fetchImpl,
  );
  const device = await readPayload(deviceResponse);
  const deviceCode = text(device.device_code);
  const userCode = text(device.user_code);
  if (deviceCode === "" || userCode === "") throw new GitHubOAuthError("invalid");
  const intervalMs = Math.max(1, number(device.interval) || 5) * MIN_INTERVAL_MS;
  onCode({ userCode, verificationUri: verificationUri(text(device.verification_uri)) });

  let waitMs = intervalMs;
  for (;;) {
    await sleep(waitMs);
    if (signal?.aborted) throw new GitHubOAuthError("cancelled");
    const response = await postForm(
      endpoint(options.base, ACCESS_TOKEN_PATH),
      { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_GRANT },
      signal,
      fetchImpl,
    );
    const payload = await readPayload(response);
    const token = text(payload.access_token);
    if (token !== "") {
      // The same shape normalizeGitToken accepts; anything else cannot be a header.
      if (token.length > 255 || /\s/.test(token)) throw new GitHubOAuthError("invalid");
      return token;
    }
    const error = text(payload.error);
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      waitMs += SLOW_DOWN_MS;
      continue;
    }
    if (error === "expired_token") throw new GitHubOAuthError("expired");
    if (error === "access_denied") throw new GitHubOAuthError("denied");
    throw new GitHubOAuthError("invalid");
  }
}

// ── session token (memory only, per tab) ────────────────────────────────────

let sessionToken: string | null = null;

/** The token signed in during this page's lifetime, or null. */
export function githubSessionToken(): string | null {
  return sessionToken;
}

/** Keep the token in memory for the tab; never write it to storage. */
export function setGitHubSessionToken(token: string | null): void {
  sessionToken = token;
}
