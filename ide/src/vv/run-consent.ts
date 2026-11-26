// Should this device install dependencies and start `vite dev` without asking?
//
// The whole VM lives in this tab (see device-health.ts): the kernel, the file-system
// worker, one worker per guest process and rolldown's wasm threads share one JS heap,
// with the vite worker alone around 540 MB. On a phone that is the difference between
// a slow first paint and the browser closing the tab, and it is not what the device is
// for: the graph, the editor, the files and the chat all work without a dev server.
//
// The answer has to be synchronous — it gates a click — so this reads only what the
// browser exposes immediately, and never waits for a kernel diag round-trip.
//
// What it cannot see: navigator.deviceMemory is Chromium-only, clamped at 8 GB and
// absent on Safari, so "unknown" must be treated as "small", not as "big".

export interface RunDeviceSignals {
  /** `(pointer: coarse)`: the primary input is a finger. */
  coarsePointer: boolean;
  /** `(hover: none)`: no hover-capable pointer at all — a touchscreen laptop reports `hover`. */
  hoverNone: boolean;
  /** navigator.deviceMemory: Chromium only, null on Safari/Firefox. */
  deviceMemoryGb: number | null;
  cores: number | null;
}

export const RUN_DEVICE_LIMITS = {
  /** At or below this the browser itself says the device is small. */
  minDeviceMemoryGb: 4,
  minCores: 4,
} as const;

/** `limited` means: ask before installing and starting the dev server. */
export type RunRisk = "ok" | "limited";

/**
 * Touch-first is the primary signal: it is the one every browser exposes, and the
 * honest one — a phone with 8 GB still shares a single heap with the VM. `hover`
 * keeps a touchscreen laptop on the desktop path, which is the whole reason both
 * halves of the pointer media query are read.
 *
 * The second case is a weak machine with a mouse; it requires BOTH signals to be low
 * so a modest Chromebook with a trackpad is not nagged on every run.
 */
export function classifyRunRisk(signals: RunDeviceSignals): RunRisk {
  if (signals.coarsePointer && signals.hoverNone) return "limited";
  const lowMemory =
    signals.deviceMemoryGb !== null &&
    signals.deviceMemoryGb <= RUN_DEVICE_LIMITS.minDeviceMemoryGb;
  const fewCores = signals.cores !== null && signals.cores <= RUN_DEVICE_LIMITS.minCores;
  return lowMemory && fewCores ? "limited" : "ok";
}

/** The signals the browser offers right now; an unavailable one is null, never a throw. */
export function readRunDeviceSignals(): RunDeviceSignals {
  const matches = (query: string): boolean =>
    typeof matchMedia === "undefined" ? false : matchMedia(query).matches;
  const nav =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  return {
    coarsePointer: matches("(pointer: coarse)"),
    hoverNone: matches("(hover: none)"),
    deviceMemoryGb: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
  };
}

let cached: RunRisk | null = null;

/** Once per page load: the pointer does not change under a running tab. */
export function runRisk(): RunRisk {
  cached ??= classifyRunRisk(readRunDeviceSignals());
  return cached;
}

// ── the pending request ─────────────────────────────────────────────────────
// The controller cannot render, so on a `limited` answer it parks the root here and
// the shell's dialog asks. Deliberately not in the IDE snapshot: it is a one-shot
// prompt with two answers, not state any other surface renders (same choice as
// reset-ui.ts). The grant lives for the tab and is never persisted.

const listeners = new Set<() => void>();
let pending: string | null = null;
let granted = false;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeRunConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The root waiting for an answer, or null when nothing is pending. */
export function getPendingRun(): string | null {
  return pending;
}

/** True when the caller must wait for the user instead of starting the run. */
export function requestRunConsent(root: string): boolean {
  if (granted || runRisk() === "ok") return false;
  pending = root;
  notify();
  return true;
}

/** The user accepted: the root to start, and no more asking in this tab. */
export function grantRunConsent(): string | null {
  const root = pending;
  granted = true;
  pending = null;
  notify();
  return root;
}

export function declineRunConsent(): void {
  if (pending === null) return;
  pending = null;
  notify();
}
