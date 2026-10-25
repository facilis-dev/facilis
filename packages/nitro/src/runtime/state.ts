/**
 * Process-level state shared by the dev endpoints.
 *
 * Boot time is captured when the Nitro worker imports this module, which is exactly the
 * "server is up" moment `/__facilis/health` reports (SPEC §6.3/§6.7).
 */
export const bootedAt = new Date().toISOString();
