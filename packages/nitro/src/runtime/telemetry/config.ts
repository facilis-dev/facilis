/**
 * Backend telemetry switch and export target (D-203 §1, §5).
 *
 * The switch and the collector target are deploy-time settings, not runtime toggles: the
 * managed deploy turns them on from the build's telemetry options
 * (docs/MANAGED-DEPLOYMENT.md) and nothing in the app can flip them per request. Off is the
 * default, and dev is off regardless of the flag — inside the WebContainer/preview no
 * telemetry leaves the machine (D-200).
 */
import { isProductionEnvironment } from "../env.ts";

/** The deploy-time switch; only an explicit "on" enables the pipeline. */
export const TELEMETRY_ENV = "FACILIS_TELEMETRY";
/** The operator's collector base URL; the framework appends the per-signal path. */
export const TELEMETRY_ENDPOINT_ENV = "FACILIS_TELEMETRY_ENDPOINT";
/** Head-sampling ratio for root spans, 0..1; unset keeps everything. */
export const TELEMETRY_SAMPLING_ENV = "FACILIS_TELEMETRY_SAMPLING";
/** `service.name` for the exported resource; unset uses the framework default. */
export const TELEMETRY_SERVICE_ENV = "FACILIS_TELEMETRY_SERVICE";
/** The deployment's identifier, exported as `deployment.id`; optional. */
export const DEPLOYMENT_ID_ENV = "FACILIS_DEPLOYMENT_ID";

export const DEFAULT_SERVICE_NAME = "facilis-app";

export interface TelemetryConfig {
  readonly enabled: boolean;
  /** Collector base URL without a trailing slash, or null when unset or not an http(s) URL. */
  readonly endpoint: string | null;
  readonly sampling: number;
  readonly serviceName: string;
  readonly deploymentId: string | null;
}

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const requested = env[TELEMETRY_ENV]?.trim() === "on";
  // Fail-closed toward "no telemetry" (D-146): a dev/test boot never starts the pipeline, even
  // when the deploy leaked its environment into the process.
  return {
    enabled: requested && isProductionEnvironment(env),
    endpoint: readEndpoint(env[TELEMETRY_ENDPOINT_ENV]),
    sampling: readSampling(env[TELEMETRY_SAMPLING_ENV]),
    serviceName: readNonEmpty(env[TELEMETRY_SERVICE_ENV]) ?? DEFAULT_SERVICE_NAME,
    deploymentId: readNonEmpty(env[DEPLOYMENT_ID_ENV]),
  };
}

function readNonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * A collector base URL: http(s), no query or fragment, no trailing slash. The framework
 * appends `/v1/traces` and `/v1/metrics` itself, so a config cannot point two signals at
 * unrelated paths.
 */
function readEndpoint(value: string | undefined): string | null {
  const raw = readNonEmpty(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.search !== "" || url.hash !== "") return null;
    return (url.origin + url.pathname).replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** An out-of-range or unparsable ratio keeps everything rather than silently sampling nothing. */
function readSampling(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  if (raw === "") return 1;
  const ratio = Number(raw);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 1;
}
