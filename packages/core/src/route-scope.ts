import type { AuthContext } from "@facilis/auth";
import type { PolicyScope } from "@facilis/db";

import { DEFAULT_TENANT_ID } from "./tenancy.ts";

/**
 * The request scope the wrapper opens for the policy-scoped client (SPEC §7.4, D-040).
 *
 * The tenant is the deployment's, never the session's: this is the only value RLS will accept,
 * so a session cannot widen or change the scope. Anonymous routes (registration/login) get the
 * same value, which is what makes the tenant column default and the RLS WITH CHECK agree. The
 * framework constant is the fallback so an app that forgets FACILIS_TENANT_ID behaves like the
 * Nitro middleware. Permissions travel in app.permissions for permission views (D-098); they
 * are the session's expanded set, never the route's required list.
 */
export interface ResolvedScope extends PolicyScope {
  readonly tenantId: string;
}

export function resolveScope(
  auth: AuthContext | null,
  facilis: { defaultTenantId?: string } | undefined,
): ResolvedScope {
  const tenantId = facilis?.defaultTenantId ?? DEFAULT_TENANT_ID;
  const permissions = auth?.permissions ?? [];
  return auth === null
    ? { tenantId, permissions }
    : { tenantId, permissions, userId: auth.userId, roles: auth.roles };
}
