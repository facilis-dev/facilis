/**
 * Spike telemetry configuration (issue #133, D-203).
 *
 * The production contract makes "telemetry enabled" a BUILD-TIME deploy option and answers
 * 404 otherwise (spec §8.8). The spike approximates that switch with boot-time environment
 * variables so one build can be booted both ways and the 404-on-disabled assertion is real.
 */

export const INGESTION_PATH = "/__facilis/telemetry/v1/traces";
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_SPANS_PER_BATCH = 256;
export const DEFAULT_SPANS_PER_MINUTE = 24;

export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly collectorUrl: string | null;
  readonly allowedOrigins: readonly string[];
  readonly spansPerMinute: number;
  readonly maxBodyBytes: number;
  readonly maxSpansPerBatch: number;
}

/** Origins are scheme + host + port: no wildcard, no "null" (spec §8.8). */
function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter((value) => value.length > 0 && value !== "*" && value !== "null");
}

export function readTelemetryConfig(
  env: Record<string, string | undefined> = process.env,
): TelemetryConfig {
  const collectorUrl = env.FACILIS_OTLP_ENDPOINT?.trim() || null;
  const spansPerMinute = Number(env.FACILIS_TELEMETRY_SPANS_PER_MIN ?? DEFAULT_SPANS_PER_MINUTE);
  return {
    enabled: env.FACILIS_TELEMETRY === "on" && collectorUrl !== null,
    collectorUrl,
    allowedOrigins: parseOrigins(env.FACILIS_TELEMETRY_ORIGINS),
    spansPerMinute:
      Number.isFinite(spansPerMinute) && spansPerMinute > 0
        ? spansPerMinute
        : DEFAULT_SPANS_PER_MINUTE,
    maxBodyBytes: MAX_BODY_BYTES,
    maxSpansPerBatch: MAX_SPANS_PER_BATCH,
  };
}
