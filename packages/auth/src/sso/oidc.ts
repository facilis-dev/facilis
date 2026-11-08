import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import {
  runtimeFetch,
  type FetchLike,
  type FetchResponse,
  type IdentityClaims,
} from "./contracts.ts";
import { SsoError } from "./errors.ts";
import { requestToken, readVerifiedClaim, type TokenPayload } from "./oauth2.ts";
import type { OidcProviderConfig } from "./providers.ts";

/**
 * OpenID Connect authorization code flow with PKCE and nonce (D-120).
 *
 * Discovery is fetched once per provider and cached with a TTL; the ID token is verified with
 * `jose` against the provider JWKS, the issuer, the client id and the nonce. Tests inject the
 * fetch (discovery) and the JWKS resolver (`createLocalJWKSet`), so the suite needs no network.
 */

export const OIDC_DISCOVERY_TTL_MS = 5 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export interface OidcDiscovery {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint?: string;
  readonly jwksUri: string;
}

export interface OidcDeps {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly jwksResolver?: (jwksUri: string) => JWTVerifyGetKey;
  readonly discoveryTtlMs?: number;
}

interface CachedDiscovery {
  readonly value: OidcDiscovery;
  readonly fetchedAt: number;
}

const discoveryCache = new Map<string, CachedDiscovery>();

/** Clears the per-provider discovery cache (tests, and a deliberate provider reconfiguration). */
export function clearOidcDiscoveryCache(): void {
  discoveryCache.clear();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readUrl(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

function parseDiscovery(value: unknown): OidcDiscovery {
  const record = readRecord(value);
  if (record === null) throw new SsoError("sso_provider_unavailable", "discovery shape");
  const authorizationEndpoint = readUrl(record, "authorization_endpoint");
  const tokenEndpoint = readUrl(record, "token_endpoint");
  const jwksUri = readUrl(record, "jwks_uri");
  const issuer = typeof record["issuer"] === "string" ? record["issuer"] : "";
  if (authorizationEndpoint === undefined || tokenEndpoint === undefined || jwksUri === undefined) {
    throw new SsoError("sso_provider_unavailable", "discovery is missing an endpoint");
  }
  const userinfoEndpoint = readUrl(record, "userinfo_endpoint");
  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    jwksUri,
    ...(userinfoEndpoint === undefined ? {} : { userinfoEndpoint }),
  };
}

/** Fetches and caches `<issuer>/.well-known/openid-configuration` for one provider. */
export async function discoverOidc(
  provider: OidcProviderConfig,
  deps: OidcDeps = {},
): Promise<OidcDiscovery> {
  const now = deps.now?.() ?? Date.now();
  const ttl = deps.discoveryTtlMs ?? OIDC_DISCOVERY_TTL_MS;
  const key = `${provider.id}\u0000${provider.issuer}`;
  const cached = discoveryCache.get(key);
  if (cached !== undefined && now - cached.fetchedAt < ttl) return cached.value;

  const fetch = deps.fetch ?? runtimeFetch();
  let response: FetchResponse;
  try {
    response = await fetch(discoveryUrl(provider.issuer), {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new SsoError("sso_provider_unavailable", "discovery request failed", { cause: error });
  }
  if (!response.ok) {
    throw new SsoError("sso_provider_unavailable", `discovery ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new SsoError("sso_provider_unavailable", "discovery is not JSON", { cause: error });
  }
  const discovery = parseDiscovery(payload);
  discoveryCache.set(key, { value: discovery, fetchedAt: now });
  return discovery;
}

export interface OidcAuthorizeInput {
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}

/** The authorization URL: response_type=code, scopes, state, nonce and PKCE S256. */
export function buildOidcAuthorizeUrl(
  provider: OidcProviderConfig,
  discovery: OidcDiscovery,
  input: OidcAuthorizeInput,
): string {
  const url = new URL(discovery.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcTokenInput {
  readonly code: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly fetch?: FetchLike;
}

export function exchangeOidcCode(
  client: { clientId: string; clientSecret?: string; tokenAuth: OidcProviderConfig["tokenAuth"] },
  discovery: OidcDiscovery,
  input: OidcTokenInput,
): Promise<TokenPayload> {
  return requestToken({
    endpoint: discovery.tokenEndpoint,
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

export interface OidcClaims {
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Verifies an ID token: signature (JWKS), issuer, audience, expiry (jose) and the nonce. */
export async function verifyOidcIdToken(
  provider: OidcProviderConfig,
  discovery: OidcDiscovery,
  idToken: string,
  nonce: string,
  deps: OidcDeps = {},
): Promise<OidcClaims> {
  try {
    const resolver =
      deps.jwksResolver?.(discovery.jwksUri) ?? createRemoteJWKSet(new URL(discovery.jwksUri));
    const { payload } = await jwtVerify(idToken, resolver, {
      issuer: provider.issuer,
      audience: provider.clientId,
    });
    const tokenNonce = payload["nonce"];
    if (typeof tokenNonce !== "string" || tokenNonce !== nonce) {
      throw new SsoError("sso_identity_invalid", "id_token nonce mismatch");
    }
    const subject = payload.sub;
    if (typeof subject !== "string" || subject.length === 0) {
      throw new SsoError("sso_identity_invalid", "id_token has no subject");
    }
    const email = typeof payload["email"] === "string" ? payload["email"] : undefined;
    const claim = readVerifiedClaim(payload["email_verified"]);
    return {
      subject,
      ...(email === undefined ? {} : { email }),
      emailVerified: claim ?? provider.assumeEmailVerified,
    };
  } catch (error) {
    if (error instanceof SsoError) throw error;
    throw new SsoError("sso_identity_invalid", "id_token verification failed", { cause: error });
  }
}

async function fetchUserinfo(
  discovery: OidcDiscovery,
  accessToken: string,
  fetch: FetchLike,
): Promise<Record<string, unknown>> {
  if (discovery.userinfoEndpoint === undefined) {
    throw new SsoError("sso_identity_invalid", "no userinfo endpoint");
  }
  let response: FetchResponse;
  try {
    response = await fetch(discovery.userinfoEndpoint, {
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
  const record = readRecord(payload);
  if (record === null) throw new SsoError("sso_exchange_failed", "userinfo shape");
  return record;
}

/**
 * Resolves the OIDC identity: ID-token claims, with a userinfo fallback only when the email
 * claim is absent. The userinfo `sub` must agree with the verified ID-token subject.
 */
export async function resolveOidcIdentity(
  provider: OidcProviderConfig,
  discovery: OidcDiscovery,
  token: TokenPayload,
  nonce: string,
  deps: OidcDeps = {},
): Promise<IdentityClaims> {
  if (token.idToken === undefined) throw new SsoError("sso_identity_invalid", "no id_token");
  const claims = await verifyOidcIdToken(provider, discovery, token.idToken, nonce, deps);
  let email = claims.email;
  let emailVerified = claims.emailVerified;

  if (email === undefined) {
    const userinfo = await fetchUserinfo(
      discovery,
      token.accessToken,
      deps.fetch ?? runtimeFetch(),
    );
    const userinfoSubject = readString(userinfo, "sub");
    if (userinfoSubject !== undefined && userinfoSubject !== claims.subject) {
      throw new SsoError("sso_identity_invalid", "userinfo subject mismatch");
    }
    email = readString(userinfo, "email");
    emailVerified = readVerifiedClaim(userinfo["email_verified"]) ?? provider.assumeEmailVerified;
  }

  if (email === undefined || !EMAIL_PATTERN.test(email)) {
    throw new SsoError("sso_identity_invalid", "no email claim");
  }
  return { provider: provider.id, subject: claims.subject, email, emailVerified };
}
