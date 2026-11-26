/**
 * Backend telemetry switch and export target (D-203 §1, §5).
 *
 * The switch and the collector target are deploy-time settings, not runtime toggles: the
 * managed deploy turns them on from the build's telemetry options
 * (docs/MANAGED-DEPLOYMENT.md) and nothing in the app can flip them per request. Off is the
 * default, and dev is off regardless of the flag — inside the WebContainer/preview no
 * telemetry leaves the machine (D-200).
 */
import { SecretString } from "@facilis.dev/core";

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
/** Comma-separated exact origins allowed to POST to the ingestion route (spec §8.8). */
export const TELEMETRY_ORIGINS_ENV = "FACILIS_TELEMETRY_ORIGINS";
/** The public write-only tenant key the browser presents to the ingestion route. */
export const TELEMETRY_TENANT_KEY_ENV = "FACILIS_TELEMETRY_TENANT_KEY";
/**
 * The frontend RUM opt-in (D-209), read at BUILD time by the facilisRum() Vite companion.
 * Explicit and off by default: the backend switch alone never enables the browser client.
 */
export const TELEMETRY_FE_ENV = "FACILIS_TELEMETRY_FE";
/** Per-origin/IP/tenant span-per-minute token-bucket cap for the ingestion route. */
export const TELEMETRY_SPANS_PER_MIN_ENV = "FACILIS_TELEMETRY_SPANS_PER_MIN";

export const DEFAULT_SERVICE_NAME = "facilis-app";
/** The spec §8.8 body cap: the same 1 MiB defineAuthorizedHandler applies (D-153). */
export const MAX_INGEST_BODY_BYTES = 1024 * 1024;
/** Maximum spans per batch (the spike's proven cap); excess is a 400, not a truncation. */
export const MAX_SPANS_PER_BATCH = 256;
export const DEFAULT_SPANS_PER_MINUTE = 24;

export interface TelemetryConfig {
  readonly enabled: boolean;
  /** Collector base URL without a trailing slash, or null when unset or not an http(s) URL. */
  readonly endpoint: string | null;
  readonly sampling: number;
  readonly serviceName: string;
  readonly deploymentId: string | null;
  /** Exact origins (scheme+host+port) allowed to POST; empty means the app's own origin only. */
  readonly allowedOrigins: readonly string[];
  /** The public write-only key; null when unset, which rejects every ingestion POST. */
  readonly tenantKey: string | null;
  readonly spansPerMinute: number;
}

export function readTelemetryConfig(
  runtime: Readonly<Record<string, unknown>>,
  env: NodeJS.ProcessEnv = process.env,
): TelemetryConfig {
  // Fail-closed toward "no telemetry" (D-146): a dev/test boot never starts the pipeline, even
  // when the deploy leaked its environment into the process.
  return {
    enabled: runtime["telemetryEnabled"] === true && isProductionEnvironment(env),
    endpoint: readEndpoint(runtime["telemetryEndpoint"]),
    sampling: readSampling(runtime["telemetrySampling"]),
    serviceName: readNonEmpty(runtime["telemetryService"]) ?? DEFAULT_SERVICE_NAME,
    deploymentId: readNonEmpty(runtime["deploymentId"]),
    allowedOrigins: readOrigins(runtime["telemetryOrigins"]),
    tenantKey: readTenantKey(runtime["telemetryTenantKey"]),
    spansPerMinute: readSpansPerMinute(runtime["telemetrySpansPerMin"]),
  };
}

function readNonEmpty(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/**
 * A collector base URL: http(s), no query or fragment, no trailing slash. The framework
 * appends `/v1/traces` and `/v1/metrics` itself, so a config cannot point two signals at
 * unrelated paths.
 */
function readEndpoint(value: unknown): string | null {
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
function readSampling(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

/**
 * Origins are reduced to scheme+host+port (the deploy block does the same): no path, no
 * wildcard, no "null". An unparsable entry is dropped, shrinking the allowlist — fail-closed.
 */
function readOrigins(value: unknown): string[] {
  const origins: string[] = [];
  const entries =
    typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  for (const entry of entries) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    if (trimmed === "" || trimmed === "*" || trimmed === "null") continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch {
      // Not an absolute origin: it can never match a request Origin, so it is not admitted.
    }
  }
  return origins;
}

/** A key with whitespace could never survive proxy header handling: treat it as unset. */
function readTenantKey(value: unknown): string | null {
  const text = value instanceof SecretString ? value.reveal() : value;
  const raw = typeof text === "string" ? text.trim() : "";
  return raw === "" || /\s/.test(raw) ? null : raw;
}

/** An out-of-range or unparsable cap falls back to the default rather than admitting a flood. */
function readSpansPerMinute(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SPANS_PER_MINUTE;
}
