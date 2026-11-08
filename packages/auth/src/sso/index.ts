/**
 * SSO (D-120): OIDC, generic OAuth2 and SAML as framework auth.
 *
 * Root re-exports only; the implementation is split by concern under this directory.
 */

export { authIdentities, authSsoStates } from "./tables.ts";
export type {
  AuthIdentityRow,
  AuthSsoStateRow,
  NewAuthIdentityRow,
  NewAuthSsoStateRow,
} from "./tables.ts";
export {
  SSO_ERROR_CODES,
  failureRedirectPath,
  isSsoError,
  SsoError,
  ssoErrorCode,
} from "./errors.ts";
export type { SsoErrorCode } from "./errors.ts";
export {
  isProviderConfigured,
  missingCredentialEnv,
  publicProviderList,
  resolveProvider,
  SSO_NAMESPACE,
} from "./providers.ts";
export type {
  Oauth2Mapping,
  Oauth2ProviderConfig,
  OidcProviderConfig,
  PublicSsoProvider,
  ResolvedSsoProvider,
  SamlProviderConfig,
  SsoConfigLike,
  SsoProviderBase,
  SsoProviderConfig,
  SsoProviderKind,
  SsoTokenAuth,
} from "./providers.ts";
export { consumeSsoState, createSsoState, MAX_REDIRECT_TO, normalizeRedirectTo } from "./state.ts";
export type { CreateSsoStateInput } from "./state.ts";
export {
  buildOidcAuthorizeUrl,
  clearOidcDiscoveryCache,
  discoverOidc,
  exchangeOidcCode,
  OIDC_DISCOVERY_TTL_MS,
  resolveOidcIdentity,
  verifyOidcIdToken,
} from "./oidc.ts";
export { createPkcePair } from "./pkce.ts";
export type {
  OidcAuthorizeInput,
  OidcClaims,
  OidcDeps,
  OidcDiscovery,
  OidcTokenInput,
} from "./oidc.ts";
export type { PkcePair } from "./pkce.ts";
export {
  buildOauth2AuthorizeUrl,
  exchangeOauth2Code,
  readDottedPath,
  readVerifiedClaim,
  requestToken,
  resolveOauth2Identity,
  resolveOauth2IdentityFromCode,
} from "./oauth2.ts";
export type {
  Oauth2Identity,
  Oauth2TokenInput,
  RequestTokenInput,
  TokenClientConfig,
  TokenPayload,
} from "./oauth2.ts";
export { buildAuthnRequestXml, buildSamlRedirect, validateSamlResponse } from "./saml.ts";
export type {
  BuiltSamlRequest,
  SamlProfileLike,
  SamlValidator,
  SamlValidatorFactory,
  ValidateSamlInput,
} from "./saml.ts";
export { IDENTITY_TABLES, resolveIdentity } from "./identity.ts";
export type {
  IdentityOutcome,
  IdentityProviderPolicy,
  IdentityResolution,
  ResolveIdentityOptions,
} from "./identity.ts";
export { completeLogin, startLogin } from "./login.ts";
export { DEFAULT_POST_LOGIN_PATH, postLoginPath, ssoCallbackUrl } from "./paths.ts";
export type { CompleteLoginInput, CompleteLoginResult, SsoFlowDeps } from "./login.ts";
export type {
  FetchInit,
  FetchLike,
  FetchResponse,
  IdentityClaims,
  SsoAudit,
  SsoAuditInput,
  SystemElevationOptions,
  SystemRunner,
} from "./contracts.ts";
