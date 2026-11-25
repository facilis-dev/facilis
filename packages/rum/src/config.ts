/**
 * Build-time RUM configuration (D-209). The literal is injected by the facilisRum() Vite
 * companion at `vite build` time only; dev builds define it as null, so the client is
 * completely silent there (D-200). Nothing reads env at runtime: a browser has none.
 */

export interface RumConfig {
  readonly tenantKey: string;
  readonly endpoint: string;
  readonly sampling: number;
  readonly serviceName: string;
  readonly deploymentId: string | null;
}

declare global {
  const __FACILIS_RUM_CONFIG__: RumConfig | null | undefined;
}

/** Read the injected literal; anything missing or malformed is null (a no-op boot). */
export function readRumConfig(): RumConfig | null {
  // typeof guard: an unbundled import (tests, SSR/prerender) has no define at all.
  if (typeof __FACILIS_RUM_CONFIG__ === "undefined" || __FACILIS_RUM_CONFIG__ === null) return null;
  const raw: unknown = __FACILIS_RUM_CONFIG__;
  if (typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const tenantKey = record["tenantKey"];
  const endpoint = record["endpoint"];
  const serviceName = record["serviceName"];
  // Fail-closed like the ingestion gates: a key with whitespace could never survive header
  // handling, and an export without a target or a service identity is pointless.
  if (typeof tenantKey !== "string" || tenantKey === "" || /\s/.test(tenantKey)) return null;
  if (typeof endpoint !== "string" || endpoint === "") return null;
  if (typeof serviceName !== "string" || serviceName === "") return null;
  const deploymentId = typeof record["deploymentId"] === "string" ? record["deploymentId"] : null;
  return {
    tenantKey,
    endpoint,
    sampling: readSampling(record["sampling"]),
    serviceName,
    deploymentId,
  };
}

/** Mirrors the backend's readSampling: an invalid ratio keeps everything, never nothing. */
function readSampling(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}
