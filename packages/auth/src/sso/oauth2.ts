import { runtimeFetch, type FetchLike, type FetchResponse } from "./contracts.ts";
import { SsoError } from "./errors.ts";
import type { Oauth2ProviderConfig, SsoTokenAuth } from "./providers.ts";

/**
 * Generic OAuth2 authorization-code provider (D-120).
 *
 * Unlike OIDC there is no discovery or ID token, so the identity comes from the userinfo endpoint
 * plus a dotted-path mapping declared in facilis.config.ts. Email verification is claim-driven:
 * a provider that never reports the claim must opt in with `assumeEmailVerified`.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export interface TokenPayload {
  readonly accessToken: string;
  readonly idToken?: string;
}

/** The subset of a provider the token endpoint needs; OIDC and OAuth2 share it. */
export interface TokenClientConfig {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly tokenAuth: SsoTokenAuth;
}

export interface RequestTokenInput {
  readonly endpoint: string;
  readonly client: TokenClientConfig;
  readonly form: Readonly<Record<string, string>>;
  readonly fetch?: FetchLike;
}

function requireFetch(fetch: FetchLike | undefined): FetchLike {
  return fetch ?? runtimeFetch();
}

function basicAuthorization(clientId: string, clientSecret: string): string {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

/**
 * POSTs an authorization-code grant to the token endpoint with the configured client auth mode.
 *
 * The response is parsed for `access_token`/`id_token` only; a provider error body is never
 * surfaced (it can echo the code), just the safe `sso_exchange_failed` code.
 */
export async function requestToken(input: RequestTokenInput): Promise<TokenPayload> {
  const form = new URLSearchParams(input.form);
  form.set("client_id", input.client.clientId);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (input.client.tokenAuth === "client_secret_basic") {
    if (input.client.clientSecret === undefined) throw new SsoError("sso_provider_unavailable");
    headers["authorization"] = basicAuthorization(input.client.clientId, input.client.clientSecret);
  } else if (input.client.tokenAuth === "client_secret_post") {
    if (input.client.clientSecret === undefined) throw new SsoError("sso_provider_unavailable");
    form.set("client_secret", input.client.clientSecret);
  }

  let response: FetchResponse;
  try {
    response = await requireFetch(input.fetch)(input.endpoint, {
      method: "POST",
      headers,
      body: form.toString(),
    });
  } catch (error) {
    throw new SsoError("sso_exchange_failed", "token request failed", { cause: error });
  }
  if (!response.ok) throw new SsoError("sso_exchange_failed", `token endpoint ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new SsoError("sso_exchange_failed", "token response is not JSON", { cause: error });
  }
  if (typeof payload !== "object" || payload === null) {
    throw new SsoError("sso_exchange_failed", "token response shape");
  }
  const record = payload as Record<string, unknown>;
  const accessToken = readString(record, "access_token");
  if (accessToken === undefined) throw new SsoError("sso_exchange_failed", "no access_token");
  const idToken = readString(record, "id_token");
  return idToken === undefined ? { accessToken } : { accessToken, idToken };
}

/** Reads a dotted path (`data.user.email`) out of parsed userinfo JSON. */
export function readDottedPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Truthiness of a verification claim: boolean true or the string "true" only. */
export function readVerifiedClaim(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function requireString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Subjects are often numeric in OAuth2 userinfo (e.g. a GitHub `id`). */
function requireScalar(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return requireString(value);
}

/**
 * The authorization URL: response_type=code, the configured scopes, state, PKCE S256 and the
 * redirect URI. PKCE is sent unconditionally (RFC 6749 lets a provider ignore it) so a public
 * `tokenAuth: "none"` client is protected exactly like the OIDC flow (D-120).
 */
export function buildOauth2AuthorizeUrl(
  provider: Oauth2ProviderConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(provider.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (provider.scopes.length > 0) url.searchParams.set("scope", provider.scopes.join(" "));
  return url.toString();
}

export interface Oauth2TokenInput {
  readonly code: string;
  readonly redirectUri: string;
  /** PKCE verifier stored in the single-use state row; required, like the OIDC flow. */
  readonly codeVerifier: string;
  readonly fetch?: FetchLike;
}

export function exchangeOauth2Code(
  client: TokenClientConfig,
  provider: Oauth2ProviderConfig,
  input: Oauth2TokenInput,
): Promise<TokenPayload> {
  return requestToken({
    endpoint: provider.tokenEndpoint,
    client,
    form: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    },
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
  });
}

async function fetchUserinfo(
  provider: Oauth2ProviderConfig,
  accessToken: string,
  fetch: FetchLike,
): Promise<Record<string, unknown>> {
  let response: FetchResponse;
  try {
    response = await fetch(provider.userinfoEndpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
  } catch (error) {
    throw new SsoError("sso_exchange_failed", "userinfo request failed", { cause: error });
  }
  if (!response.ok) throw new SsoError("sso_exchange_failed", `userinfo ${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new SsoError("sso_exchange_failed", "userinfo is not JSON", { cause: error });
  }
  if (typeof payload !== "object" || payload === null) {
    throw new SsoError("sso_exchange_failed", "userinfo shape");
  }
  return payload as Record<string, unknown>;
}

export interface Oauth2Identity {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/** Maps the userinfo JSON onto the identity key via the configured dotted paths. */
export function resolveOauth2Identity(
  provider: Oauth2ProviderConfig,
  userinfo: Record<string, unknown>,
): Oauth2Identity {
  const subject = requireScalar(readDottedPath(userinfo, provider.mapping.subject));
  if (subject === undefined) throw new SsoError("sso_identity_invalid", "no subject mapping");
  const rawEmail = requireString(readDottedPath(userinfo, provider.mapping.email));
  if (rawEmail === undefined || !EMAIL_PATTERN.test(rawEmail)) {
    throw new SsoError("sso_identity_invalid", "no email mapping");
  }
  const claim =
    provider.mapping.emailVerified === undefined
      ? undefined
      : readVerifiedClaim(readDottedPath(userinfo, provider.mapping.emailVerified));
  const emailVerified = claim ?? provider.assumeEmailVerified;
  return { subject, email: rawEmail, emailVerified };
}

/** Token exchange + userinfo + mapping, the complete generic-OAuth2 identity resolution. */
export async function resolveOauth2IdentityFromCode(
  client: TokenClientConfig,
  provider: Oauth2ProviderConfig,
  input: Oauth2TokenInput,
): Promise<Oauth2Identity> {
  const token = await exchangeOauth2Code(client, provider, input);
  const userinfo = await fetchUserinfo(provider, token.accessToken, input.fetch ?? runtimeFetch());
  return resolveOauth2Identity(provider, userinfo);
}
