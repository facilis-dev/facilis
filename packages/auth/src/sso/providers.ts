import { SsoError } from "./errors.ts";

/**
 * Provider resolution against the environment (D-120).
 *
 * The config commits the ENV VAR NAMES that hold secrets; the values never appear in the project.
 * A provider whose secret (or SAML certificate) is missing is unusable: it is hidden from the
 * public list and a start attempt answers `sso_provider_unavailable`. The value itself is never
 * read for logging, compared or echoed.
 *
 * The types here mirror the `auth.sso` section of facilis.config.ts structurally. @facilis/core
 * already validates that config and depends on @facilis/auth, so auth cannot import the core
 * types without a package cycle; a parsed core provider is assignable to these shapes.
 */

export type SsoProviderKind = "oidc" | "oauth2" | "saml";
export type SsoTokenAuth = "client_secret_post" | "client_secret_basic" | "none";

export interface SsoProviderBase {
  readonly id: string;
  readonly label?: string;
  readonly autoProvision: boolean;
  readonly defaultRole?: string;
}

export interface OidcProviderConfig extends SsoProviderBase {
  readonly kind: "oidc";
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecretEnv?: string;
  readonly scopes: readonly string[];
  readonly tokenAuth: SsoTokenAuth;
  readonly assumeEmailVerified: boolean;
}

export interface Oauth2Mapping {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified?: string;
}

export interface Oauth2ProviderConfig extends SsoProviderBase {
  readonly kind: "oauth2";
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint: string;
  readonly clientId: string;
  readonly clientSecretEnv?: string;
  readonly scopes: readonly string[];
  readonly tokenAuth: SsoTokenAuth;
  readonly mapping: Oauth2Mapping;
  readonly assumeEmailVerified: boolean;
}

export interface SamlProviderConfig extends SsoProviderBase {
  readonly kind: "saml";
  readonly entryPoint: string;
  /** SP entity id declared to the IdP, and the expected assertion audience. */
  readonly issuer: string;
  readonly certificateEnv: string;
  readonly emailAttribute: string;
  readonly wantAssertionsSigned: boolean;
  readonly wantResponseSigned: boolean;
}

export type SsoProviderConfig = OidcProviderConfig | Oauth2ProviderConfig | SamlProviderConfig;

/** Structural shape of `config.auth.sso` after defineConfig applied its defaults. */
export interface SsoConfigLike {
  readonly providers: readonly SsoProviderConfig[];
  readonly failureRedirect: string;
  readonly stateTtlMs: number;
  /** `config.auth.sso.linkPasswordAccounts`; absent means false (D-151, SEC-02). */
  readonly linkPasswordAccounts?: boolean;
}

/** What the login page may see: no secret, no endpoint beyond the framework start URL. */
export interface PublicSsoProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: SsoProviderKind;
  /** Framework-owned start URL, always relative to the application origin. */
  readonly startUrl: string;
}

/** A provider plus the environment values the flow needs; never serialised. */
export interface ResolvedSsoProvider {
  readonly config: SsoProviderConfig;
  readonly clientSecret?: string;
  readonly idpCertificate?: string;
}

export const SSO_NAMESPACE = "/api/auth/sso";

/** The environment variable whose absence makes a provider unusable, if any. */
export function missingCredentialEnv(provider: SsoProviderConfig): string | undefined {
  if (provider.kind === "saml") return provider.certificateEnv;
  if (provider.tokenAuth === "none") return undefined;
  return provider.clientSecretEnv;
}

function readEnv(
  name: string | undefined,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (name === undefined) return undefined;
  const value = environment[name];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** True when every environment value this provider needs is present. */
export function isProviderConfigured(
  provider: SsoProviderConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (provider.kind === "saml") {
    return readEnv(provider.certificateEnv, environment) !== undefined;
  }
  if (provider.tokenAuth === "none") return true;
  return readEnv(provider.clientSecretEnv, environment) !== undefined;
}

/** The public list rendered by the login page; unconfigured providers are omitted. */
export function publicProviderList(
  config: SsoConfigLike,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PublicSsoProvider[] {
  return config.providers
    .filter((provider) => isProviderConfigured(provider, environment))
    .map((provider) => ({
      id: provider.id,
      label: provider.label ?? provider.id,
      kind: provider.kind,
      startUrl: `${SSO_NAMESPACE}/${encodeURIComponent(provider.id)}/start`,
    }));
}

/**
 * Finds a configured provider and reads its environment secret(s).
 *
 * Unknown provider => `sso_provider_unknown`; a known provider missing its env value =>
 * `sso_provider_unavailable` (the caller logs a warning with the ENV VAR NAME only).
 */
export function resolveProvider(
  config: SsoConfigLike,
  id: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedSsoProvider {
  const provider = config.providers.find((candidate) => candidate.id === id);
  if (provider === undefined) throw new SsoError("sso_provider_unknown");

  if (provider.kind === "saml") {
    const idpCertificate = readEnv(provider.certificateEnv, environment);
    if (idpCertificate === undefined) throw new SsoError("sso_provider_unavailable");
    return { config: provider, idpCertificate };
  }

  if (provider.tokenAuth === "none") return { config: provider };
  const clientSecret = readEnv(provider.clientSecretEnv, environment);
  if (clientSecret === undefined) throw new SsoError("sso_provider_unavailable");
  return { config: provider, clientSecret };
}
