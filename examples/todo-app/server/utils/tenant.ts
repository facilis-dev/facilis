import { DEFAULT_TENANT_ID } from "@facilis/core";

/**
 * Single-tenant Phase 1 (decision O-003): one deployment serves one tenant, taken from the
 * environment. The fallback is the framework constant, so the app and the Nitro middleware
 * always agree on the tenant GUC for unauthenticated requests (registration/login).
 */
export function tenantIdFromEnv(): string {
  const raw = process.env.FACILIS_TENANT_ID;
  return raw !== undefined && raw.length > 0 ? raw : DEFAULT_TENANT_ID;
}
