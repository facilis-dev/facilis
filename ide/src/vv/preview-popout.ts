// The standalone pop-out preview window (D-019, MANAGED-DEPLOYMENT §5).
//
// Default (same-origin pop-out): open on the studio's OWN origin so the tab lands in the
// kernel's storage partition and proxies through the same-origin SW — frictionless, but not
// isolated from the IDE. COOP:same-origin puts it in a separate browsing-context group (no
// window.opener); HTTP routes and the ws/SSE tunnels go through the SW, and the session relays
// inbound frames back (relayToExternalPreviews).
//
// Isolated pop-out (previewPopout: "isolated" in mode B, always in mode C): open on the preview
// origin so it cannot touch IDE storage/OPFS. Same-site preview origins connect gate-free; a
// cross-site one shows the one-time "connect this tab" gate (previewConnectingHtml in sw.js).

import type { KernelBridge } from "./kernel";
import { popoutPreviewUrl } from "./preview-url";

/** Open a preview port in its own browser tab. */
export function openPreviewWindow(bridge: KernelBridge, port: number): void {
  if (bridge.mode === "wildcard") {
    window.open(bridge.previewUrlFor(port, "/"), "_blank");
    return;
  }
  window.open(popoutPreviewUrl(bridge, port, bridge.popoutIsolated), "_blank");
}
