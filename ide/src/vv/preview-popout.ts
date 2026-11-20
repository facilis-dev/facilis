import type { KernelBridge } from "./kernel";
import { popoutPreviewUrl } from "./preview-url";

/** Open a preview port in its own browser tab. Returns false when the browser blocked
 * the pop-up, so the caller can say so instead of leaving a silent no-op. */
export function openPreviewWindow(bridge: KernelBridge, port: number): boolean {
  const url =
    bridge.mode === "wildcard"
      ? bridge.previewUrlFor(port, "/")
      : popoutPreviewUrl(bridge, port, bridge.popoutIsolated);
  return window.open(url, "_blank") !== null;
}

/** The port the always-available external-preview control should open, in priority
 * order: the active folder's running app (so a second running project cannot steal it),
 * the active preview tab, then the only listening port. Null disables the control
 * rather than guessing which of several services the user meant. */
export function pickExternalPort(
  activeFolderPort: number | null,
  activePreviewPort: number | null,
  ports: readonly { port: number }[],
): number | null {
  if (activeFolderPort !== null) return activeFolderPort;
  if (activePreviewPort !== null) return activePreviewPort;
  return ports.length === 1 ? (ports[0]?.port ?? null) : null;
}
