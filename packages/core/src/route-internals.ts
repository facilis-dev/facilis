import type { AuthContext } from "@facilis.dev/auth";

import type { FacilisHandlerEvent, FacilisRequestEvent } from "./event.ts";

/**
 * Route-wrapper plumbing split from route.ts (D-226) so the security-critical file stays
 * under the 300-line limit without hiding the request flow.
 */

/**
 * Public routes (`permission: []`) may run anonymously, so their `ctx.auth` is nullable;
 * every privileged form gets the guaranteed non-null `AuthContext` (contracts §4.4).
 */
export type AuthorizedHandlerAuth<Permission extends string | readonly string[]> =
  Permission extends readonly []
    ? AuthContext | null
    : Permission extends readonly [string, ...string[]]
      ? AuthContext
      : Permission extends string
        ? AuthContext
        : AuthContext | null;

export function normalizePermissions(permission: string | readonly string[]): readonly string[] {
  return typeof permission === "string" ? [permission] : permission;
}

/**
 * The event a project handler receives: the same req/res objects and a context copy that
 * keeps auth/params plus ONLY the safe facilis fields. The root Drizzle client is attached
 * privately (request-database.ts) and never reaches the handler surface (D-099/D-226).
 */
export function toHandlerEvent(
  event: FacilisRequestEvent,
  facilis: NonNullable<FacilisRequestEvent["context"]["facilis"]>,
): FacilisHandlerEvent {
  const { auth, params } = event.context;
  const defaultTenantId = facilis.defaultTenantId;
  return {
    context: {
      ...(auth === undefined ? {} : { auth }),
      ...(params === undefined ? {} : { params }),
      ...(defaultTenantId === undefined ? {} : { facilis: { defaultTenantId } }),
    },
    req: event.req,
    ...(event.res === undefined ? {} : { res: event.res }),
  };
}
