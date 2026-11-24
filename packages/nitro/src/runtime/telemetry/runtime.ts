/**
 * The installed telemetry runtime (D-203 §1).
 *
 * Instrumentation asks `activeTelemetry()` before starting a span; `null` means disabled and
 * every call site then does nothing at all — no span, no SDK, no attribute building. The Nitro
 * plugin is the only place that installs it, and tests may install a recorder instead.
 */
import { trace, type Tracer } from "@opentelemetry/api";

import { readTelemetryConfig } from "./config.ts";

/** Tracer scope name: stable across the framework so a collector can group spans by library. */
const TRACER_NAME = "facilis";

export interface TelemetryRuntime {
  readonly tracer: Tracer;
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
 * whole pipeline is absent rather than dormant.
 */
export function bootstrapTelemetry(env: NodeJS.ProcessEnv = process.env): TelemetryRuntime | null {
  const runtime = readTelemetryConfig(env).enabled
    ? { tracer: trace.getTracer(TRACER_NAME) }
    : null;
  installed = runtime;
  return runtime;
}
