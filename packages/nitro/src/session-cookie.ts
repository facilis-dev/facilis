import { SESSION_COOKIE_NAME } from "@facilis/auth";
import type { FacilisHandlerEvent } from "@facilis/core";
import { deleteCookie, getCookie, setCookie, type H3Event } from "nitro/h3";

import { isProductionEnvironment } from "./runtime/env.ts";

/**
 * Session-cookie helpers for route handlers (contracts §4.4, D-038).
 *
 * h3 owns the cookie surface: `setCookie`/`deleteCookie` serialise the attributes and
 * write them to the EVENT's response headers, which is the only place a cookie is merged
 * into the response by this server (a `Set-Cookie` on a returned `Response` is dropped
 * in the in-VM Nitro dev path — D-038). They also APPEND rather than replace, so a cookie
 * another handler staged on the same response is not clobbered.
 *
 * The attribute set is the framework's, not the app's: every Facilis app that logs a user
 * in must emit the same `facilis_session` cookie (HttpOnly, Path=/, SameSite=Lax, Secure
 * in production), so apps call these helpers instead of h3's setters directly.
 */

const COOKIE_PATH = "/";
const MS_PER_SECOND = 1000;

export interface SessionCookieOptions {
  /** Session lifetime: the cookie must expire with the `sessions` row (config.auth.sessionDurationMs). */
  readonly ttlMs: number;
  /** `Secure` attribute; defaults to the fail-closed production check (D-146). */
  readonly secure?: boolean;
}

/**
 * Nitro hands handlers a real `H3Event`, but the route contract is core's structural
 * event: core, auth and db never import h3, so a handler can be reused by any Fetch
 * runtime (contracts §4.1). The cast is the one place that narrows back to the runtime.
 */
function h3Event(event: FacilisHandlerEvent): H3Event {
  if (event.res === undefined) {
    throw new Error(
      "facilis: the server event has no response headers to stage the session cookie on",
    );
  }
  return event as unknown as H3Event;
}

/** Sets `facilis_session` on the response of the current request. */
export function setSessionCookie(
  event: FacilisHandlerEvent,
  sessionId: string,
  options: SessionCookieOptions,
): void {
  setCookie(h3Event(event), SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    path: COOKIE_PATH,
    sameSite: "lax",
    secure: options.secure ?? isProductionEnvironment(),
    maxAge: Math.max(0, Math.floor(options.ttlMs / MS_PER_SECOND)),
  });
}

/** Expires `facilis_session` on the response of the current request (logout). */
export function clearSessionCookie(event: FacilisHandlerEvent): void {
  deleteCookie(h3Event(event), SESSION_COOKIE_NAME, { path: COOKIE_PATH });
}

/** Reads the session id from the request; `null` when the request carries no session. */
export function sessionIdFromRequest(event: FacilisHandlerEvent): string | null {
  const value = getCookie(event as unknown as H3Event, SESSION_COOKIE_NAME);
  return value === undefined || value.length === 0 ? null : value;
}
