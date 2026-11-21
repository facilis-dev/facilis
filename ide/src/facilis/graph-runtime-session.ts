// The runtime lens's live wiring (issue #72): owns the #71 seam while the lens is active.
// activate() enables the collector and the injected preview client with the graph's route
// templates and subscribes the store to the sample tap — history accumulates even when live
// is off. setLive(true) adds the repaint subscription and the 1 s tick (window expiry,
// sparkline scroll); setLive(false) removes both, so the surfaces read the last snapshot.
// deactivate() sleeps the client, drops every subscription and timer and resets the store:
// graph-runtime-session.test.ts drives exactly this lifecycle as the leak check.
//
// Split from the React hook so the lifecycle is unit-testable in the node vitest environment
// (fakes for window/timers, like runtime-metrics-wire.test.ts). Window and timers are touched
// only inside the functions, never at import time.

import { subscribeRuntimeMetricSamples, subscribeRuntimeMetrics } from "./runtime-metrics";
import {
  disableRuntimeMetrics,
  enableRuntimeMetrics,
  type RuntimeMetricsSession,
} from "./runtime-metrics-wire";
import { getRuntimeLensStore } from "./graph-runtime";

/** The live tick cadence: window expiry and the sparkline scroll, once per second. */
export const RUNTIME_TICK_MS = 1000;

export interface RuntimeLensSession {
  /** (Re-)enable with the drawn view's templates; a route-set change re-enables cleanly. */
  activate(templates: readonly string[], live: boolean): void;
  setLive(live: boolean): void;
  deactivate(): void;
  isActive(): boolean;
}

/**
 * buildSession reads the kernel token from the bridge at activation time; null (no token,
 * e.g. a preview that never booted) keeps the lens in the empty state — never a throw.
 */
export function createRuntimeLensSession(
  buildSession: () => RuntimeMetricsSession | null,
): RuntimeLensSession {
  const store = getRuntimeLensStore();
  let active = false;
  // Whether THIS session enabled the wire: deactivate must not sleep a session it never
  // woke (the dev handle may own the seam while the lens is inactive).
  let wokePreview = false;
  let unsubscribeSamples: (() => void) | null = null;
  let unsubscribeRepaint: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const clearLive = (): void => {
    if (unsubscribeRepaint !== null) {
      unsubscribeRepaint();
      unsubscribeRepaint = null;
    }
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const applyLive = (next: boolean): void => {
    clearLive();
    store.setLive(next, Date.now());
    if (next && active) {
      // Repaints cover collector enable/disable (a disable empties the lens); the tick
      // covers window expiry while no traffic arrives.
      unsubscribeRepaint = subscribeRuntimeMetrics(() => store.tick(Date.now()));
      timer = setInterval(() => store.tick(Date.now()), RUNTIME_TICK_MS);
    }
  };

  const deactivate = (): void => {
    clearLive();
    if (unsubscribeSamples !== null) {
      unsubscribeSamples();
      unsubscribeSamples = null;
    }
    if (wokePreview) {
      disableRuntimeMetrics();
      wokePreview = false;
    }
    store.dispose();
    active = false;
  };

  const activate = (templates: readonly string[], nextLive: boolean): void => {
    // Analysis refresh: replace the previous session cleanly before waking the new one.
    deactivate();
    active = true;
    store.enable(templates);
    const session = buildSession();
    wokePreview = session !== null && enableRuntimeMetrics(session, templates);
    unsubscribeSamples = subscribeRuntimeMetricSamples((samples, now) =>
      store.ingest(samples, now),
    );
    store.tick(Date.now());
    applyLive(nextLive);
  };

  return {
    activate,
    setLive(next) {
      if (active) applyLive(next);
    },
    deactivate,
    isActive() {
      return active;
    },
  };
}
