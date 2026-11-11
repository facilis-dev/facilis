/**
 * Safe machine codes for the SSO namespace (D-120).
 *
 * The browser is redirected to `failureRedirect?sso_error=<code>`; an internal message, a token,
 * an authorization code or a SAML payload never reaches the client. Callers log the cause
 * server-side through `ctx.log` and expose only the code.
 */

export const SSO_ERROR_CODES = [
  "sso_provider_unknown",
  "sso_provider_unavailable",
  "sso_state_invalid",
  "sso_exchange_failed",
  "sso_identity_invalid",
  "sso_email_unverified",
  // Verified IdP email matched a PASSWORD account that is not verified, in a deployment where
  // email verification is off: linking it would be account pre-hijacking (SEC-02, D-156).
  "sso_email_conflict",
  "sso_account_not_found",
  "sso_internal_error",
] as const;

export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

/** Thrown inside the flow; the route maps it to a redirect code, never to its message. */
export class SsoError extends Error {
  readonly code: SsoErrorCode;

  constructor(code: SsoErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? code, options);
    this.name = "SsoError";
    this.code = code;
  }
}

export function isSsoError(error: unknown): error is SsoError {
  return error instanceof SsoError;
}

/** Normalises any thrown value to a safe code; an unexpected failure is `sso_internal_error`. */
export function ssoErrorCode(error: unknown): SsoErrorCode {
  return isSsoError(error) ? error.code : "sso_internal_error";
}

/**
 * Appends `sso_error=<code>` to the configured failure redirect, keeping its existing query
 * string and fragment-free path. The redirect is same-origin by config validation (D-120).
 */
export function failureRedirectPath(failureRedirect: string, code: SsoErrorCode): string {
  const url = new URL(failureRedirect, "http://facilis.invalid");
  url.searchParams.set("sso_error", code);
  return `${url.pathname}${url.search}`;
}
