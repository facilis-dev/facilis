// The browser transport for the PTC runner: a sandboxed iframe at /ptc-runner.html.
//
// Why an opaque-origin iframe: the program is untrusted code, so it must not reach the
// IDE's DOM, storage, OPFS or network. sandbox="allow-scripts" (and deliberately NO
// allow-same-origin) gives it a null origin; the page's CSP header blocks egress (proved
// by spikes/ptc-sandbox and re-checked by scripts/dev/check-ptc-runner.mjs).
//
// The runner page owns the blob Worker; this module only forwards messages and can drop
// the whole frame to stop a program that never yields.

import type { PtcChild, PtcChildFactory } from "./protocol";

const RUNNER_PAGE = "/ptc-runner.html";
/** A missing/blocked page must become a typed run failure, not a hung turn. */
const LOAD_TIMEOUT_MS = 10_000;

function isMessageRecord(data: unknown): data is Record<string, unknown> {
  // postMessage already structured-clones, so this only rejects primitives that the
  // runner could not interpret as protocol messages anyway.
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function childFor(frame: HTMLIFrameElement): PtcChild {
  const listeners = new Set<(data: unknown) => void>();
  let terminated = false;
  const onMessage = (event: MessageEvent) => {
    // Only the frame we created may talk to us: source identity plus the opaque origin
    // (event.origin === "null") is the whole trust boundary of this transport.
    if (terminated || event.source !== frame.contentWindow) return;
    if (!isMessageRecord(event.data)) return;
    for (const listener of listeners) listener(event.data);
  };
  window.addEventListener("message", onMessage);

  return {
    post(message) {
      if (terminated) return;
      // targetOrigin "*" is required: an opaque origin cannot be matched by name.
      frame.contentWindow?.postMessage(message, "*");
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    // Removing the frame destroys its document and with it the blob Worker, which is the
    // only portable hard stop for a busy loop (terminate() is the contract, D-101).
    terminate(_reason: string) {
      if (terminated) return;
      terminated = true;
      window.removeEventListener("message", onMessage);
      listeners.clear();
      frame.remove();
    },
  };
}

export function createRunnerFrameChild(): PtcChildFactory {
  return {
    create() {
      if (typeof document === "undefined") {
        return Promise.reject(new Error("the PTC runner frame needs a browser document"));
      }
      return new Promise<PtcChild>((resolve, reject) => {
        const frame = document.createElement("iframe");
        // Keep the program out of the IDE's origin and out of the layout.
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("title", "PTC sandbox");
        frame.style.display = "none";
        frame.src = RUNNER_PAGE;

        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          frame.remove();
          reject(new Error("the PTC runner page did not load within " + LOAD_TIMEOUT_MS + "ms"));
        }, LOAD_TIMEOUT_MS);

        frame.addEventListener(
          "load",
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(childFor(frame));
          },
          { once: true },
        );
        document.body.appendChild(frame);
      });
    },
  };
}
