/**
 * Origin allowlist (spec §8.8): exact scheme + host + port match. `null`, a wildcard or a
 * missing Origin is never accepted — the gate exists so a foreign page cannot use the app as
 * an open OTLP relay.
 */
export function isAllowedOrigin(allowedOrigins: readonly string[], origin: string | null): boolean {
  if (origin === null || origin === "" || origin === "null" || origin.includes("*")) {
    return false;
  }
  const normalized = origin.replace(/\/$/, "");
  return allowedOrigins.some((allowed) => allowed === normalized);
}
