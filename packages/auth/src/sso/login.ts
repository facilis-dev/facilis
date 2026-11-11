import { randomToken } from "../crypto.ts";
import type { FetchLike, IdentityClaims, SsoAudit, SystemRunner } from "./contracts.ts";
import { isSsoError, SsoError, ssoErrorCode } from "./errors.ts";
import { resolveIdentity, type IdentityResolution } from "./identity.ts";
import {
  buildOidcAuthorizeUrl,
  discoverOidc,
  exchangeOidcCode,
  resolveOidcIdentity,
  type OidcDeps,
} from "./oidc.ts";
import { buildOauth2AuthorizeUrl, resolveOauth2IdentityFromCode } from "./oauth2.ts";
import { createPkcePair } from "./pkce.ts";
import { postLoginPath, ssoCallbackUrl } from "./paths.ts";
import {
  missingCredentialEnv,
  resolveProvider,
  type ResolvedSsoProvider,
  type SsoConfigLike,
  type SsoProviderConfig,
} from "./providers.ts";
import { buildSamlRedirect, validateSamlResponse, type SamlValidatorFactory } from "./saml.ts";
import { consumeSsoState, createSsoState, normalizeRedirectTo } from "./state.ts";
import type { AuthSsoStateRow } from "./tables.ts";
/**
 * The two ends of an SSO login (D-120): start builds the IdP redirect and stores the single-use
 * attempt; complete consumes that attempt, resolves the identity and returns the user.
 *
 * The route owns the HTTP envelope (302, cookie, failure redirect); this module owns the protocol
 * and never exposes an internal message. Every failure is an {@link SsoError} whose code is safe
 * to append to `failureRedirect`.
 */
export interface SsoFlowDeps {
  /** `config.auth.sso` after defaults. */
  readonly sso: SsoConfigLike;
  /** `config.auth.defaultRole`: the role a provisioned user gets without a provider override. */
  readonly defaultRole: string;
  /** Deployment origin (`FACILIS_PUBLIC_ORIGIN` or the request origin), no trailing slash. */
  readonly publicOrigin: string;
  readonly system: SystemRunner;
  readonly audit: SsoAudit;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Diagnostic line for an unusable provider; must never receive a secret value. */
  readonly warn?: (message: string, data: Record<string, unknown>) => void;
  /** Test seam for discovery/JWKS; defaults to the flow's fetch/now. */
  readonly oidc?: OidcDeps;
  /** Test seam for the lazily imported SAML validator. */
  readonly samlValidatorFactory?: SamlValidatorFactory;
}
function oidcDeps(deps: SsoFlowDeps): OidcDeps {
  if (deps.oidc !== undefined) return deps.oidc;
  return {
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}
function resolve(deps: SsoFlowDeps, providerId: string): ResolvedSsoProvider {
  try {
    return resolveProvider(deps.sso, providerId, deps.environment ?? process.env);
  } catch (error) {
    if (isSsoError(error) && error.code === "sso_provider_unavailable") {
      const provider = deps.sso.providers.find((candidate) => candidate.id === providerId);
      const envName = provider === undefined ? undefined : missingCredentialEnv(provider);
      // The warning names the provider and the ENV VAR, never its value (D-120).
      deps.warn?.("sso provider is not configured", {
        provider: providerId,
        ...(envName === undefined ? {} : { env: envName }),
      });
    }
    throw error;
  }
}
function nowOf(deps: SsoFlowDeps): number {
  return deps.now?.() ?? Date.now();
}
function tokenClient(config: SsoProviderConfig, secret: string | undefined) {
  if (config.kind === "saml") throw new SsoError("sso_state_invalid");
  return {
    clientId: config.clientId,
    tokenAuth: config.tokenAuth,
    ...(secret === undefined ? {} : { clientSecret: secret }),
  };
}
function identityPolicy(config: SsoProviderConfig) {
  return {
    id: config.id,
    autoProvision: config.autoProvision,
    ...(config.defaultRole === undefined ? {} : { defaultRole: config.defaultRole }),
  };
}
async function startRedirect(
  deps: SsoFlowDeps,
  input: { readonly providerId: string; readonly redirectTo: string | null },
  provider: ResolvedSsoProvider,
): Promise<string> {
  const config = provider.config;
  const redirectTo = normalizeRedirectTo(input.redirectTo);
  const now = nowOf(deps);
  const redirectUri = ssoCallbackUrl(deps.publicOrigin, config.id);

  if (config.kind === "saml") {
    const state = randomToken(32);
    const built = await buildSamlRedirect(config, redirectUri, state, now);
    await createSsoState(
      deps.system,
      {
        provider: config.id,
        ttlMs: deps.sso.stateTtlMs,
        redirectTo,
        requestId: built.requestId,
        state,
      },
      now,
    );
    return built.redirectUrl;
  }

  if (config.kind === "oidc") {
    const discovery = await discoverOidc(config, oidcDeps(deps));
    const pkce = await createPkcePair();
    const nonce = randomToken(32);
    const state = await createSsoState(
      deps.system,
      {
        provider: config.id,
        ttlMs: deps.sso.stateTtlMs,
        redirectTo,
        nonce,
        codeVerifier: pkce.verifier,
      },
      now,
    );
    return buildOidcAuthorizeUrl(config, discovery, {
      redirectUri,
      state: state.state,
      nonce,
      codeChallenge: pkce.challenge,
    });
  }

  const pkce = await createPkcePair();
  const state = await createSsoState(
    deps.system,
    {
      provider: config.id,
      ttlMs: deps.sso.stateTtlMs,
      redirectTo,
      codeVerifier: pkce.verifier,
    },
    now,
  );
  return buildOauth2AuthorizeUrl(config, redirectUri, state.state, pkce.challenge);
}
/** Starts a login and returns the IdP URL; the attempt is stored as one single-use row. */
export async function startLogin(
  deps: SsoFlowDeps,
  input: { readonly providerId: string; readonly redirectTo: string | null },
): Promise<{ readonly redirectUrl: string }> {
  try {
    const provider = resolve(deps, input.providerId);
    const redirectUrl = await startRedirect(deps, input, provider);
    deps.audit({
      operation: "auth:sso:start",
      outcome: "succeeded",
      details: { provider: input.providerId },
    });
    return { redirectUrl };
  } catch (error) {
    deps.audit({
      operation: "auth:sso:start",
      outcome: "failed",
      errorCode: ssoErrorCode(error),
      details: { provider: input.providerId },
    });
    throw error;
  }
}
export type CompleteLoginInput =
  | { readonly method: "GET"; readonly code: string; readonly state: string }
  | { readonly method: "POST"; readonly samlResponse: string; readonly relayState: string };
export interface CompleteLoginResult {
  readonly userId: string;
  readonly redirectTo: string;
  readonly resolution: IdentityResolution;
}
async function claimsFromCode(
  deps: SsoFlowDeps,
  provider: ResolvedSsoProvider,
  code: string,
  state: AuthSsoStateRow,
): Promise<IdentityClaims> {
  const config = provider.config;
  if (state.provider !== config.id) throw new SsoError("sso_state_invalid");
  if (config.kind === "oidc") {
    if (state.nonce === null || state.codeVerifier === null)
      throw new SsoError("sso_state_invalid");
    const discovery = await discoverOidc(config, oidcDeps(deps));
    const token = await exchangeOidcCode(tokenClient(config, provider.clientSecret), discovery, {
      code,
      redirectUri: ssoCallbackUrl(deps.publicOrigin, config.id),
      codeVerifier: state.codeVerifier,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    return resolveOidcIdentity(config, discovery, token, state.nonce, oidcDeps(deps));
  }
  if (config.kind === "oauth2") {
    if (state.codeVerifier === null) throw new SsoError("sso_state_invalid");
    const identity = await resolveOauth2IdentityFromCode(
      tokenClient(config, provider.clientSecret),
      config,
      {
        code,
        redirectUri: ssoCallbackUrl(deps.publicOrigin, config.id),
        codeVerifier: state.codeVerifier,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      },
    );
    return { provider: config.id, ...identity };
  }
  throw new SsoError("sso_state_invalid");
}
async function completeGet(
  deps: SsoFlowDeps,
  provider: ResolvedSsoProvider,
  input: Extract<CompleteLoginInput, { method: "GET" }>,
): Promise<CompleteLoginResult> {
  const state = await consumeSsoState(deps.system, input.state, nowOf(deps));
  const claims = await claimsFromCode(deps, provider, input.code, state);
  const resolution = await resolveIdentity(deps.system, claims, identityPolicy(provider.config), {
    defaultRole: deps.defaultRole,
    linkPasswordAccounts: deps.sso.linkPasswordAccounts === true,
    audit: deps.audit,
  });
  return { userId: resolution.userId, redirectTo: postLoginPath(state), resolution };
}
async function completePost(
  deps: SsoFlowDeps,
  provider: ResolvedSsoProvider,
  input: Extract<CompleteLoginInput, { method: "POST" }>,
): Promise<CompleteLoginResult> {
  const config = provider.config;
  if (config.kind !== "saml") throw new SsoError("sso_state_invalid");
  const state = await consumeSsoState(deps.system, input.relayState, nowOf(deps));
  if (state.provider !== config.id) throw new SsoError("sso_state_invalid");
  const claims = await validateSamlResponse({
    provider: config,
    certificate: provider.idpCertificate ?? "",
    callbackUrl: ssoCallbackUrl(deps.publicOrigin, config.id),
    samlResponse: input.samlResponse,
    requestId: state.requestId,
    ...(deps.samlValidatorFactory === undefined
      ? {}
      : { validatorFactory: deps.samlValidatorFactory }),
  });
  const resolution = await resolveIdentity(deps.system, claims, identityPolicy(config), {
    defaultRole: deps.defaultRole,
    linkPasswordAccounts: deps.sso.linkPasswordAccounts === true,
    audit: deps.audit,
  });
  return { userId: resolution.userId, redirectTo: postLoginPath(state), resolution };
}
/**
 * Completes a login: consumes the single-use state, exchanges the code/assertion and resolves the
 * identity. A failure is rethrown as the safe code the route turns into a redirect.
 */
export async function completeLogin(
  deps: SsoFlowDeps,
  providerId: string,
  input: CompleteLoginInput,
): Promise<CompleteLoginResult> {
  try {
    const provider = resolve(deps, providerId);
    if (input.method === "POST" && provider.config.kind !== "saml") {
      throw new SsoError("sso_state_invalid");
    }
    if (input.method === "GET" && provider.config.kind === "saml") {
      throw new SsoError("sso_state_invalid");
    }
    const result =
      input.method === "POST"
        ? await completePost(deps, provider, input)
        : await completeGet(deps, provider, input);
    deps.audit({
      operation: "auth:sso:login",
      outcome: "succeeded",
      details: { provider: providerId },
    });
    return result;
  } catch (error) {
    deps.audit({
      operation: "auth:sso:login",
      outcome: "failed",
      errorCode: ssoErrorCode(error),
      details: { provider: providerId },
    });
    throw error;
  }
}
