/**
 * Single-tenant fallback tenant id (DECISIONS O-003).
 *
 * A deployment serves one tenant, normally provided by `FACILIS_TENANT_ID`. EVERY request —
 * anonymous or authenticated — is scoped to that deployment tenant (D-040); this constant is the
 * last-resort default when the variable is unset. It lives in the framework so the Nitro
 * middleware, the handler scoping and generated apps cannot drift apart.
 */
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
