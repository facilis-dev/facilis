import { createSession, SsoError, type CompleteLoginResult } from "@facilis.dev/auth";
import {
  defineAuthorizedHandler,
  fail,
  type FacilisConfig,
  type FacilisHandlerEvent,
} from "@facilis.dev/core";
import type { PolicyScopedDatabase } from "@facilis.dev/db";

import { getBootstrap } from "../runtime/bootstrap.ts";
import { jsonResult, parseRequestUrl, toResponse } from "../runtime/http.ts";
import {
  completeSsoLogin,
  listSsoProviders,
  SSO_ROUTE_PREFIX,
  SSO_ROUTE_TABLES,
  ssoFailureLocation,
  startSsoLogin,
  type SsoRequestContext,
} from "../runtime/sso.ts";
import { setSessionCookie } from "../session-cookie.ts";

/**
 * The framework-owned SSO namespace (D-120, SPEC §5.3).
 *
 *   GET  /api/auth/sso/providers          -> { providers } (no-store, no secrets)
 *   GET  /api/auth/sso/:provider/start    -> 302 to the IdP (creates the single-use state)
 *   GET  /api/auth/sso/:provider/callback -> OIDC/OAuth2 code callback
 *   POST /api/auth/sso/:provider/callback -> SAML ACS (application/x-www-form-urlencoded)
 *
 * One handler answers the whole namespace; the Lead registers it at `/api/auth/sso/**`.
 * Failures in a browser navigation are a 302 to `failureRedirect?sso_error=<code>`, never a
 * JSON body that could leak a library message; an unknown path/method is a plain 404.
 *
 * There is deliberately no log endpoint here, and neither the request body nor a SAML payload is
 * ever logged (D-119/D-120).
 */

const MAX_SAML_BODY_BYTES = 1024 * 1024;
const MAX_CODE_LENGTH = 8192;
const MAX_STATE_LENGTH = 256;

function notFound(): Response {
  return toResponse(jsonResult(404, { code: "not_found" }));
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function failure(config: FacilisConfig, error: unknown): Response {
  return redirect(ssoFailureLocation(config, error));
}

/** A malformed percent-encoding is caller input, not a server error: answer 404. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Splits `/api/auth/sso/<provider>/<action>` into at most two decoded segments. */
function routeSegments(pathname: string): string[] | null {
  if (pathname !== SSO_ROUTE_PREFIX && !pathname.startsWith(`${SSO_ROUTE_PREFIX}/`)) return null;
  const rest = pathname.slice(SSO_ROUTE_PREFIX.length).replace(/^\/+|\/+$/g, "");
  if (rest.length === 0) return [];
  const raw = rest.split("/");
  if (raw.length > 2 || raw.some((segment) => segment.length === 0)) return null;
  const decoded: string[] = [];
  for (const segment of raw) {
    const value = decodeSegment(segment);
    if (value === null) return null;
    decoded.push(value);
  }
  return decoded;
}

interface TextRequest {
  text?: () => Promise<string>;
}

/** The declared body size, when the client sent one. */
function contentLengthOf(event: FacilisHandlerEvent): number | null {
  const raw = event.req.headers.get("content-length");
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Reads the urlencoded ACS body; null when the runtime cannot provide a text reader. */
async function readBodyText(event: FacilisHandlerEvent): Promise<string | null> {
  const reader = (event.req as unknown as TextRequest).text;
  if (typeof reader !== "function") return null;
  try {
    return await reader.call(event.req);
  } catch {
    return null;
  }
}

/**
 * The two ACS form fields. This is a hand-written check rather than a Zod schema because the
 * framework route lives in @facilis.dev/nitro, whose dependency set has no zod (and the route wrapper
 * has no urlencoded `form` schema); the validation is the same length/presence check a schema
 * would express, and every failure maps to a safe redirect code.
 */
function readSamlForm(body: string): { samlResponse: string; relayState: string } | null {
  if (body.length > MAX_SAML_BODY_BYTES) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(body);
  } catch {
    return null;
  }
  const samlResponse = params.get("SAMLResponse");
  const relayState = params.get("RelayState");
  if (samlResponse === null || samlResponse.length === 0) return null;
  if (relayState === null || relayState.length === 0 || relayState.length > MAX_STATE_LENGTH) {
    return null;
  }
  return { samlResponse, relayState };
}

interface CallbackGetInput {
  readonly input: { readonly method: "GET"; readonly code: string; readonly state: string } | null;
  readonly error: SsoError | null;
}
function callbackGetInput(url: URL): CallbackGetInput {
  const providerError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // A provider-side error (e.g. access_denied) and a missing code are the same failure to us.
  if (providerError !== null || code === null || code.length === 0) {
    return { input: null, error: new SsoError("sso_exchange_failed") };
  }
  if (code.length > MAX_CODE_LENGTH)
    return { input: null, error: new SsoError("sso_exchange_failed") };
  if (state === null || state.length > MAX_STATE_LENGTH) {
    return { input: null, error: new SsoError("sso_state_invalid") };
  }
  return { input: { method: "GET", code, state }, error: null };
}

async function finishLogin(
  event: FacilisHandlerEvent,
  config: FacilisConfig,
  db: PolicyScopedDatabase,
  result: CompleteLoginResult,
): Promise<Response> {
  const session = await createSession(db, result.userId, { ttlMs: config.auth.sessionDurationMs });
  // h3 stages the Set-Cookie on the event response; a cookie on a returned Response is dropped
  // in the in-VM path (D-038), so the framework helper is the only correct surface.
  setSessionCookie(event, session.id, { ttlMs: config.auth.sessionDurationMs });
  return redirect(result.redirectTo);
}

export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [...SSO_ROUTE_TABLES],
    // A SAML ACS is a cross-site POST from the IdP by design; the signed assertion is the
    // protocol's own authenticity check, so the generic CSRF gate must not refuse it.
    originCheck: "skip",
    description: "Framework-owned SSO endpoints: provider list, start and callback.",
  },
  async (event, ctx) => {
    const state = await getBootstrap();
    const config = state.config;
    if (config === null) return fail("db_unavailable");

    const url = parseRequestUrl(event.req.url ?? SSO_ROUTE_PREFIX);
    const segments = routeSegments(url.pathname);
    if (segments === null) return notFound();

    const context: SsoRequestContext = {
      event,
      config,
      system: ctx.system,
      log: ctx.log,
    };
    const method = (event.req.method ?? "GET").toUpperCase();

    // GET /api/auth/sso/providers
    if (segments.length === 1 && segments[0] === "providers") {
      if (method !== "GET") return notFound();
      const providers = listSsoProviders(config);
      return toResponse(jsonResult(200, { providers }, { "cache-control": "no-store" }));
    }

    if (segments.length !== 2) return notFound();
    const providerId = segments[0];
    const action = segments[1];
    if (providerId === undefined || action === undefined) return notFound();

    // GET /api/auth/sso/:provider/start?redirect=/path
    if (action === "start") {
      if (method !== "GET") return notFound();
      try {
        const result = await startSsoLogin(context, providerId, url.searchParams.get("redirect"));
        return redirect(result.redirectUrl);
      } catch (error) {
        return failure(config, error);
      }
    }

    if (action !== "callback") return notFound();

    // GET /api/auth/sso/:provider/callback?code&state (OIDC / OAuth2)
    if (method === "GET") {
      const parsed = callbackGetInput(url);
      if (parsed.input === null)
        return failure(config, parsed.error ?? new SsoError("sso_exchange_failed"));
      try {
        const result = await completeSsoLogin(context, providerId, parsed.input);
        return await finishLogin(event, config, ctx.db, result);
      } catch (error) {
        return failure(config, error);
      }
    }

    // POST /api/auth/sso/:provider/callback (SAML ACS)
    if (method === "POST") {
      // Reject before buffering: an oversized public POST must not allocate its body.
      const declaredLength = contentLengthOf(event);
      if (declaredLength !== null && declaredLength > MAX_SAML_BODY_BYTES) {
        return failure(config, new SsoError("sso_exchange_failed"));
      }
      const body = await readBodyText(event);
      const form = body === null ? null : readSamlForm(body);
      if (form === null) return failure(config, new SsoError("sso_exchange_failed"));
      try {
        const result = await completeSsoLogin(context, providerId, {
          method: "POST",
          samlResponse: form.samlResponse,
          relayState: form.relayState,
        });
        return await finishLogin(event, config, ctx.db, result);
      } catch (error) {
        return failure(config, error);
      }
    }

    return notFound();
  },
);
