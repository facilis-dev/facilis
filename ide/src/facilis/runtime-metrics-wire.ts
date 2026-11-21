// Live wiring for the runtime metrics seam (D-200): the window-message listener that
// feeds the collector, and the control messages that wake/sleep the injected preview
// client. Kept apart from the pure collector so the contract stays unit-testable in
// the node vitest environment; this module touches window only inside its functions.
//
// The kernel token never reaches the app through the URL: the preview Service Worker
// records it and redirects it away before the document loads (D-132, sw.js). The IDE
// therefore extracts it from the bridge's own URL builder and hands it to the client
// in the enable message; every batch must echo it back (validated in runtime-metrics.ts).

import type { KernelBridge } from "@/vv/kernel";
import {
  getRuntimeMetrics,
  notifyRuntimeMetricSamples,
  notifyRuntimeMetrics,
  RUNTIME_METRICS_SOURCE,
} from "./runtime-metrics";

/** The slice of PreviewSession the wiring needs (frames + the tab they belong to). */
export interface RuntimeMetricsPreview {
  activePreviewTab(): { id: string; port: number | null } | null;
  frameFor(tabId: string): HTMLIFrameElement | undefined;
}

export interface RuntimeMetricsSession {
  /** This boot's kernel token; batches must carry exactly it. */
  readonly token: string;
  /** The preview-origin trust rule (mode A same-origin; B/C the bridge's allowlist). */
  isTrustedOrigin(origin: string): boolean;
  /** Deliver a control message to the active preview document. */
  postToPreview(message: unknown): void;
}

/** The current boot token, read from the bridge's preview URL (never from the app). */
export function kernelTokenOf(bridge: KernelBridge): string | null {
  const url = bridge.sameOriginPreviewUrl(0, "/");
  const match = /[?&]__vv_kernel=([^&#]+)/.exec(url);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] as string);
  } catch {
    return null;
  }
}

/** Same trust rule the DevTools relay uses for preview messages (preview-devtools.ts). */
export function trustedOriginPredicate(bridge: KernelBridge): (origin: string) => boolean {
  const here = typeof location !== "undefined" ? location.origin : "";
  return (origin) =>
    bridge.mode === "same-origin" ? origin === here : bridge.isTrustedPreviewOrigin(origin);
}

export function runtimeMetricsSession(
  bridge: KernelBridge,
  preview: RuntimeMetricsPreview,
): RuntimeMetricsSession | null {
  const token = kernelTokenOf(bridge);
  if (token === null) return null;
  return {
    token,
    isTrustedOrigin: trustedOriginPredicate(bridge),
    postToPreview(message) {
      const tab = preview.activePreviewTab();
      if (tab === null) return;
      // "*" like the other preview relays: modes B/C are cross-origin by design and
      // the payload carries no secret the IDE did not itself send.
      preview.frameFor(tab.id)?.contentWindow?.postMessage(message, "*");
    },
  };
}

let activeSession: RuntimeMetricsSession | null = null;
let detachListener: (() => void) | null = null;

/**
 * Wake the collector and the preview client. Returns false when there is no window
 * (non-browser context). Re-enabling replaces the previous session cleanly.
 */
export function enableRuntimeMetrics(
  session: RuntimeMetricsSession,
  routes: readonly string[],
): boolean {
  if (typeof window === "undefined") return false;
  disableRuntimeMetrics();
  const collector = getRuntimeMetrics();
  collector.enable(routes);
  const onMessage = (event: MessageEvent): void => {
    // Origin first (cheap), then the full contract incl. the current kernel token.
    if (!session.isTrustedOrigin(event.origin)) return;
    // One shared now for the collector and the sample tap (#72): the lens's 5-minute
    // window must equal collector.snapshot() for the same instant, not a later one.
    const now = Date.now();
    const result = collector.ingest(event.data, session.token, now);
    if (result.ok) {
      notifyRuntimeMetricSamples(result.samples, now);
      notifyRuntimeMetrics();
    }
  };
  window.addEventListener("message", onMessage);
  detachListener = () => {
    window.removeEventListener("message", onMessage);
  };
  activeSession = session;
  session.postToPreview({
    source: RUNTIME_METRICS_SOURCE,
    type: "enable",
    token: session.token,
    routes,
  });
  notifyRuntimeMetrics();
  return true;
}

/** Sleep the client, drop the listener and clear the buffers (rollback is silent). */
export function disableRuntimeMetrics(): void {
  if (detachListener !== null) {
    detachListener();
    detachListener = null;
  }
  if (activeSession !== null) {
    activeSession.postToPreview({ source: RUNTIME_METRICS_SOURCE, type: "disable" });
    activeSession = null;
  }
  const collector = getRuntimeMetrics();
  if (collector.isEnabled()) {
    collector.disable();
    notifyRuntimeMetrics();
  }
}
