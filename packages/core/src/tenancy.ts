/**
 * Single-tenant fallback tenant id (DECISIONS O-003).
 *
 * A deployment serves one tenant, normally provided by `FACILIS_TENANT_ID`. Unauthenticated
 * requests still need a tenant scope so that RLS-scoped inserts (registration) succeed before
 * a session exists; this constant is that last-resort default. It lives in the framework so the
 * Nitro middleware, the handler scoping and generated apps cannot drift apart.
 */
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
