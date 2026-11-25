/**
 * Frontend RUM build-time config (D-209, issue #138). The facilisRum() Vite companion reads
 * this at `vite build` only and compiles the resolved literal into the bundle as
 * __FACILIS_RUM_CONFIG__. FE is an explicit opt-in (FACILIS_TELEMETRY_FE), off by default;
 * dev never injects a config, so the browser client stays silent there (D-200).
 */
import { TELEMETRY_TRACES_ROUTE } from "../../constants.ts";
import {
  DEFAULT_SERVICE_NAME,
  DEPLOYMENT_ID_ENV,
  TELEMETRY_ENV,
  TELEMETRY_FE_ENV,
  TELEMETRY_SAMPLING_ENV,
  TELEMETRY_SERVICE_ENV,
  TELEMETRY_TENANT_KEY_ENV,
} from "./config.ts";

export interface RumBuildConfig {
  readonly tenantKey: string;
  readonly endpoint: string;
  readonly sampling: number;
  readonly serviceName: string;
  readonly deploymentId: string | null;
}

export function readRumBuildConfig(env: NodeJS.ProcessEnv = process.env): RumBuildConfig | null {
  // Both switches must be an explicit "on": the master switch and the FE opt-in.
  if (env[TELEMETRY_ENV]?.trim() !== "on") return null;
  if (env[TELEMETRY_FE_ENV]?.trim() !== "on") return null;
  const tenantKey = readTenantKey(env[TELEMETRY_TENANT_KEY_ENV]);
  // Fail-closed: without the public write-only key the ingestion route rejects every POST,
  // so a keyless build would ship a client that can never export.
  if (tenantKey === null) return null;
  return {
    tenantKey,
    // The browser always exports to the app's own framework-mounted route (same origin).
    endpoint: TELEMETRY_TRACES_ROUTE,
    sampling: readSampling(env[TELEMETRY_SAMPLING_ENV]),
    serviceName: readNonEmpty(env[TELEMETRY_SERVICE_ENV]) ?? DEFAULT_SERVICE_NAME,
    deploymentId: readNonEmpty(env[DEPLOYMENT_ID_ENV]),
  };
}

function readNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Mirrors config.ts: a key with whitespace could never survive proxy header handling. */
function readTenantKey(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  return raw === "" || /\s/.test(raw) ? null : raw;
}

/** Mirrors config.ts: an out-of-range or unparsable ratio keeps everything. */
function readSampling(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  if (raw === "") return 1;
  const ratio = Number(raw);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}
