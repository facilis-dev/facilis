import { DEFAULT_TENANT_ID, type FacilisRuntimeConfig } from "@facilis.dev/core";

import { runtimeString } from "./runtime-values.ts";

/**
 * Single-tenant fallback tenant id (DECISIONS O-003).
 *
 * The constant lives in @facilis.dev/core so the middleware, the handler scoping and generated
 * apps cannot drift apart (a mismatch makes RLS reject every insert). It is also the value the
 * session middleware requires a session's user row to carry (D-040).
 */
export { DEFAULT_TENANT_ID };

export function readDefaultTenantId(runtime: FacilisRuntimeConfig): string {
  const configured = runtimeString(runtime, "tenantId")?.trim();
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_TENANT_ID;
}
