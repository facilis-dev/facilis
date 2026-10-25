import { DEFAULT_TENANT_ID } from "@facilis/core";

/**
 * Single-tenant fallback tenant id (DECISIONS O-003).
 *
 * The constant lives in @facilis/core so the middleware, the handler scoping and generated
 * apps cannot drift apart (a mismatch makes RLS reject registration inserts).
 */
export { DEFAULT_TENANT_ID };

export function readDefaultTenantId(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment["FACILIS_TENANT_ID"]?.trim();
  return configured !== undefined && configured.length > 0 ? configured : DEFAULT_TENANT_ID;
}
