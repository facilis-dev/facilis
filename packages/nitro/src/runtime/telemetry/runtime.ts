/**
 * The installed telemetry runtime (D-203 §1).
 *
 * Instrumentation asks `activeTelemetry()` before starting a span; `null` means disabled and
 * every call site then does nothing at all — no span, no SDK, no attribute building. The Nitro
 * plugin is the only place that installs it, and tests may install a recorder instead.
 */
import type { Meter, Tracer } from "@opentelemetry/api";

import { readTelemetryConfig } from "./config.ts";
import { createTelemetryPipeline, type TelemetryExportTuning } from "./export.ts";

export interface TelemetryRuntime {
  readonly tracer: Tracer;
  readonly meter: Meter;
}

/** What a boot installed, plus the flush the process must run on shutdown. */
export interface TelemetryInstallation {
  readonly runtime: TelemetryRuntime;
  readonly shutdown: () => Promise<void>;
}

let installed: TelemetryRuntime | null = null;

/** Installs (or clears, with `null`) the runtime; the plugin owns this outside tests. */
export function installTelemetryRuntime(runtime: TelemetryRuntime | null): void {
  installed = runtime;
}

/** The runtime instrumentation may use, or null when telemetry is off. */
export function activeTelemetry(): TelemetryRuntime | null {
  return installed;
}

/**
 * Reads the deploy switch and installs the runtime. A disabled boot installs nothing, so the
 * whole pipeline is absent rather than dormant; `tuning` only exists so the export suite can
 * shrink the batch timers.
 */
export function bootstrapTelemetry(
  env: NodeJS.ProcessEnv = process.env,
  tuning?: TelemetryExportTuning,
): TelemetryInstallation | null {
  installed = null;
  const config = readTelemetryConfig(env);
  if (!config.enabled) return null;
  if (config.endpoint === null) {
    // The deploy build refuses a switched-on pipeline without a collector, so this boot was
    // started outside the build that produced it. Dropping the export is the only safe answer;
    // the warning keeps the misconfiguration visible.
    console.warn(
      "facilis: FACILIS_TELEMETRY is on but FACILIS_TELEMETRY_ENDPOINT is not an http(s) URL; no telemetry is exported",
    );
    return null;
  }
  const pipeline = createTelemetryPipeline(
    {
      endpoint: config.endpoint,
      sampling: config.sampling,
      serviceName: config.serviceName,
      deploymentId: config.deploymentId,
    },
    tuning,
  );
  installed = { tracer: pipeline.tracer, meter: pipeline.meter };
  return { runtime: installed, shutdown: pipeline.shutdown };
}
