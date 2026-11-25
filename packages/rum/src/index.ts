/**
 * Framework-owned browser RUM (issue #138, D-203 §2, D-209). bootRum() is called first in
 * the framework template entry; it is a no-op unless the build injected a config literal
 * (production + deploy telemetry options) and a window exists. Disabled/dev is completely
 * silent: no zone patching, no provider, no instrumentation, no export (D-200).
 */
import { readRumConfig } from "./config.ts";
import type { RumConfig } from "./config.ts";

export { readRumConfig } from "./config.ts";
export type { RumConfig } from "./config.ts";
export { captureRumError, sanitizeErrorType } from "./errors.ts";
export type { RumErrorSource } from "./errors.ts";

let booted = false;

export function bootRum(): void {
  // SSR/prerender has no window; a second call must not double-register the instrumentations.
  if (booted || typeof window === "undefined") return;
  const config = readRumConfig();
  if (config === null) return;
  booted = true;
  void start(config);
}

async function start(config: RumConfig): Promise<void> {
  try {
    // zone.js loads only on an enabled boot: a disabled build never patches globals. The
    // dynamic imports keep the whole SDK off the disabled path (and out of its chunk).
    await import("zone.js");
    const { createRumProvider } = await import("./provider.ts");
    const { registerRumInstrumentations } = await import("./instrumentations.ts");
    const { wireVitals } = await import("./vitals.ts");
    const { wireWindowErrors } = await import("./errors.ts");
    const provider = createRumProvider(config);
    registerRumInstrumentations(config, window.location.origin, provider);
    const tracer = provider.getTracer("@facilis.dev/rum");
    wireVitals(tracer);
    wireWindowErrors(tracer);
  } catch {
    // RUM must never break the app: a failed boot stays silent.
  }
}
