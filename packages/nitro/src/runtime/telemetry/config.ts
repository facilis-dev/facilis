/**
 * Backend telemetry switch (D-203 §1, §5).
 *
 * The switch is a deploy-time setting, not a runtime toggle: the managed deploy turns it on
 * from the build's telemetry options (docs/MANAGED-DEPLOYMENT.md) and nothing in the app can
 * flip it per request. Off is the default, and dev is off regardless of the flag — inside the
 * WebContainer/preview no telemetry leaves the machine (D-200).
 */
import { isProductionEnvironment } from "../env.ts";

/** The deploy-time switch; only an explicit "on" enables the pipeline. */
export const TELEMETRY_ENV = "FACILIS_TELEMETRY";

export interface TelemetryConfig {
  readonly enabled: boolean;
}

export function readTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const requested = env[TELEMETRY_ENV]?.trim() === "on";
  // Fail-closed toward "no telemetry" (D-146): a dev/test boot never starts the pipeline, even
  // when the deploy leaked its environment into the process.
  return { enabled: requested && isProductionEnvironment(env) };
}
