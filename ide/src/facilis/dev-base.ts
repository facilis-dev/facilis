// Where the runtime-endpoint panels send their requests (D-095/D-097).
//
// The dev server lives inside the kernel, behind the preview proxy. Its URLs must carry
// this boot's kernel token, and they must stay on THIS origin so the preview Service
// Worker can route them even when the app itself is opened in a separate browser tab
// (or the preview runs cross-origin, where a relative URL would not reach this kernel).
// `bridge.sameOriginPreviewUrl` is the one builder that guarantees that, so every panel
// uses this module instead of constructing a preview URL itself.

import type { IdeSnapshot } from "@/vv/controller";
import type { KernelBridge } from "@/vv/kernel";

export function devBase(bridge: KernelBridge, snapshot: IdeSnapshot): string | null {
  const active = snapshot.previewTabs.find((tab) => tab.id === snapshot.activePreviewId);
  const port =
    active?.port ??
    snapshot.previewTabs.find((tab) => tab.port !== null)?.port ??
    (snapshot.ports.length === 1 ? snapshot.ports[0]?.port : null) ??
    null;
  if (port === null) return null;
  return bridge.sameOriginPreviewUrl(port, "/");
}

/**
 * Insert the endpoint path between the base's path and its query string, so the kernel
 * token survives: `/preview/5173/?__vv_kernel=abc` + `/__facilis/dev/query` becomes
 * `/preview/5173/__facilis/dev/query?__vv_kernel=abc`.
 */
export function devEndpointUrl(base: string, path: string): string {
  const cut = base.search(/[?#]/);
  const head = cut === -1 ? base : base.slice(0, cut);
  const tail = cut === -1 ? "" : base.slice(cut);
  const endpoint = path.replace(/^\/+/, "");
  if (head.length === 0) return "/" + endpoint + tail;
  const prefix = head.endsWith("/") ? head : head + "/";
  return prefix + endpoint + tail;
}
