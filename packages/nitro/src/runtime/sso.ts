import type { FacilisConfig, FacilisHandlerEvent, FacilisLogger } from "@facilis.dev/core";
import {
  completeLogin,
  failureRedirectPath,
  publicProviderList,
  ssoErrorCode,
  SsoError,
  startLogin,
  type CompleteLoginInput,
  type CompleteLoginResult,
  type FetchLike,
  type OidcDeps,
  type PublicSsoProvider,
  type SamlValidatorFactory,
  type SsoFlowDeps,
  type SystemRunner,
} from "@facilis.dev/auth";

/**
 * SSO runtime glue between the framework route and @facilis.dev/auth (D-120).
 *
 * Everything environment-dependent lives here: the public origin (callback/ACS URL), the
 * failure redirect, the provider list and the flow dependency bundle. The route stays a thin
 * method+path dispatcher, which also makes this layer unit-testable without Nitro.
 */

/** Every table an SSO login can touch; must match the route's declared `dbTables`. */
export const SSO_ROUTE_TABLES = [
  "auth_sso_states",
  "auth_identities",
  "users",
  "user_roles",
  "sessions",
] as const;

export const SSO_ROUTE_PREFIX = "/api/auth/sso";

/** A header/URL-derived origin is attacker-controlled: accept only a plain host[:port]. */
const HOST_PATTERN = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

export interface SsoRequestContext {
  readonly event: FacilisHandlerEvent;
  readonly config: FacilisConfig;
  readonly system: SystemRunner;
  readonly log: FacilisLogger;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Test seam: replaced by tests so no network is touched. */
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly oidc?: OidcDeps;
  readonly samlValidatorFactory?: SamlValidatorFactory;
}

/**
 * The deployment origin used in the IdP redirect URI/ACS URL.
 *
 * `FACILIS_PUBLIC_ORIGIN` wins; otherwise the request URL/Host is used, which works for a
 * direct dev server. A deploy behind a proxy MUST set the variable: the callback URL registered
 * at the IdP has to match the public origin, and the proxy may rewrite Host.
 */
export function resolvePublicOrigin(
  event: FacilisHandlerEvent,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment["FACILIS_PUBLIC_ORIGIN"]?.trim();
  if (configured !== undefined && configured.length > 0) {
    let origin: URL;
    try {
      origin = new URL(configured);
    } catch (error) {
      throw new SsoError("sso_internal_error", "FACILIS_PUBLIC_ORIGIN is not a URL", {
        cause: error,
      });
    }
    if (origin.protocol !== "https:" && origin.protocol !== "http:") {
      throw new SsoError("sso_internal_error", "FACILIS_PUBLIC_ORIGIN must be http(s)");
    }
    if (origin.search !== "" || origin.hash !== "") {
      throw new SsoError(
        "sso_internal_error",
        "FACILIS_PUBLIC_ORIGIN must not carry a query or hash",
      );
    }
    // A preview or sub-path deployment lives under a base path (/preview/<port> in the IDE);
    // keep it so the callback/ACS URL is the one the IdP actually has to accept.
    const basePath = origin.pathname.replace(/\/+$/, "");
    return `${origin.origin}${basePath}`;
  }

  const rawUrl = event.req.url;
  if (typeof rawUrl === "string") {
    try {
      return new URL(rawUrl).origin;
    } catch {
      // Nitro can hand a path-only URL to the handler; fall through to the Host header.
    }
  }
  const host = event.req.headers.get("host");
  if (host === null || !HOST_PATTERN.test(host)) {
    throw new SsoError("sso_internal_error", "cannot resolve the request origin");
  }
  const forwarded = event.req.headers.get("x-forwarded-proto");
  const protocol = forwarded === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

/** The public provider list: ids, labels, kinds and the framework start URLs; no secrets. */
export function listSsoProviders(
  config: FacilisConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PublicSsoProvider[] {
  return publicProviderList(config.auth.sso, environment);
}

/** The redirect target for any failed start/callback, carrying only the safe error code. */
export function ssoFailureLocation(config: FacilisConfig, error: unknown): string {
  return failureRedirectPath(config.auth.sso.failureRedirect, ssoErrorCode(error));
}

function flowDeps(context: SsoRequestContext): SsoFlowDeps {
  return {
    sso: context.config.auth.sso,
    defaultRole: context.config.auth.defaultRole,
    verificationEnabled: context.config.auth.verification.enabled,
    publicOrigin: resolvePublicOrigin(context.event, context.environment ?? process.env),
    system: context.system,
    audit: (input) => context.log.audit(input),
    warn: (message, data) => context.log.warn(message, data),
    ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
    ...(context.now === undefined ? {} : { now: context.now }),
    ...(context.environment === undefined ? {} : { environment: context.environment }),
    ...(context.oidc === undefined ? {} : { oidc: context.oidc }),
    ...(context.samlValidatorFactory === undefined
      ? {}
      : { samlValidatorFactory: context.samlValidatorFactory }),
  };
}

export function startSsoLogin(
  context: SsoRequestContext,
  providerId: string,
  redirectTo: string | null,
): Promise<{ readonly redirectUrl: string }> {
  return startLogin(flowDeps(context), { providerId, redirectTo });
}

export function completeSsoLogin(
  context: SsoRequestContext,
  providerId: string,
  input: CompleteLoginInput,
): Promise<CompleteLoginResult> {
  return completeLogin(flowDeps(context), providerId, input);
}
