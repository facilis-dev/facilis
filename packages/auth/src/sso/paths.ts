import { normalizeRedirectTo } from "./state.ts";

/**
 * URL helpers for the SSO flow (D-120), shared by the login orchestration and its tests.
 *
 * Kept out of login.ts so the orchestration stays under the 300-line limit; nothing here needs
 * the flow dependencies, only the public origin and the single-use state row.
 */

/** Fallback after a login when the attempt carried no valid same-origin path. */
export const DEFAULT_POST_LOGIN_PATH = "/";

/** The callback URL registered at the IdP for one provider. */
export function ssoCallbackUrl(publicOrigin: string, providerId: string): string {
  return `${publicOrigin.replace(/\/+$/, "")}/api/auth/sso/${encodeURIComponent(providerId)}/callback`;
}

/** The post-login path for a state row; an absent or invalid value falls back to the app root. */
export function postLoginPath(state: { readonly redirectTo: string | null }): string {
  return normalizeRedirectTo(state.redirectTo) ?? DEFAULT_POST_LOGIN_PATH;
}
