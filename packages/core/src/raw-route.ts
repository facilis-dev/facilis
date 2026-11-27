/**
 * `defineRawRoute` (D-226 decision 2): the declared escape from the authorized wrapper.
 *
 * A raw route exists for protocols the standard pipeline cannot model (signature checks,
 * streaming bodies, vendor callbacks). It does not get the guarded client or parsed input;
 * it gets a declared `rawDb` accessor and the audited elevations. CSRF/origin checks, the
 * rate limit and request logging stay: "raw" widens what the handler can read, never the
 * request security around it.
 *
 * The reason is required at definition time, so a server cannot boot a route whose
 * declaration is empty and only the analyzer would have caught it.
 */
import type { AuthContext } from "@facilis.dev/auth";

import type { AuthorizedHandler, AuthorizedHandlerConfig } from "./route.ts";
import { createAuthorizedRoute } from "./route.ts";
import type { RawRouteContext } from "./route-context.ts";
import type { RateLimitWindow } from "./rate-limit.ts";
import { assertSurfaceReason } from "./surface.ts";
import type { FacilisHandlerEvent } from "./event.ts";

/** `auth: "none"` is the only way a declared route skips the session requirement. */
export type RawRouteAuth = "required" | "none";

export interface RawRouteConfig {
  /** Why this route cannot use defineAuthorizedHandler; shown in the security export. */
  readonly reason: string;
  readonly auth: RawRouteAuth;
  /** Ignored (and rejected) when auth is "none". */
  readonly permission?: string | readonly string[];
  /** Declared tables, for the export and for the elevations' subset check. Defaults to []. */
  readonly dbTables?: readonly string[];
  readonly rateLimit?: RateLimitWindow;
  readonly description?: string;
  /** Provenance written by the IDE after the user confirmed an AI-originated declaration. */
  readonly confirmed?: { readonly at: string; readonly by: string };
}

export type RawRouteHandler<A extends AuthContext | null = AuthContext | null> = (
  event: FacilisHandlerEvent,
  ctx: RawRouteContext<A>,
) => Promise<unknown> | unknown;

export function defineRawRoute<A extends AuthContext | null = AuthContext | null>(
  config: RawRouteConfig,
  handler: RawRouteHandler<A>,
): AuthorizedHandler {
  assertSurfaceReason(config.reason, "raw-route");
  if (config.auth !== "required" && config.auth !== "none") {
    throw new Error('surface_declaration_invalid: raw-route auth must be "required" or "none".');
  }
  if (config.auth === "none" && config.permission !== undefined) {
    throw new Error(
      'surface_declaration_invalid: raw-route auth "none" cannot also declare a permission.',
    );
  }
  const permission = config.auth === "none" ? [] : (config.permission ?? []);
  const base: AuthorizedHandlerConfig = {
    permission,
    dbTables: config.dbTables ?? [],
    ...(config.rateLimit === undefined ? {} : { rateLimit: config.rateLimit }),
    ...(config.description === undefined ? {} : { description: config.description }),
  };
  // The reason is validated above; createAuthorizedRoute also brands the returned handler.
  return createAuthorizedRoute(
    base,
    (event, ctx) =>
      handler(event, {
        auth: ctx.auth as A,
        params: event.context.params ?? {},
        rawDb: ctx.rawDb,
        sudo: ctx.sudo,
        system: ctx.system,
        log: ctx.log,
        requestId: ctx.requestId,
      }),
    { requireAuth: config.auth === "required" },
  );
}
