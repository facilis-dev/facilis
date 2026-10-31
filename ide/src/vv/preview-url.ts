// Preview URLs on the IDE's own origin.
//
// Several IDE tabs on one origin share one Service Worker, and their in-VM dev servers
// bind the same port, so `/preview/<port>/` alone does not say which tab owns a frame.
// The bridge adds a per-boot kernel token to same-origin preview URLs, and the SW records
// the resulting frame against that tab before redirecting the token away (see
// `KernelBridge.sameOriginPreviewUrl` and `ide/public/sw.js`). These helpers keep that
// knowledge out of `controller.ts`, which is pinned by the file-length ratchet.

import type { KernelBridge } from "./kernel";

// Pop a preview out into its own tab. Isolated pop-outs (mode B/C) live on the preview
// origin, where there is no per-tab routing; same-origin ones need the kernel token so a
// second IDE tab on this origin cannot answer for them.
export function popoutPreviewUrl(bridge: KernelBridge, port: number, isolated: boolean): string {
  if (isolated) return `${bridge.previewBase}/preview/${port}/`;
  return bridge.sameOriginPreviewUrl(port, "/");
}

// The in-server path (and query) of a preview frame's URL, for the address bar: strip the
// `/preview/<port>/` proxy prefix, our cache-bust and the kernel token. The SW redirects
// the token away before the app loads, so it is only here if that redirect did not happen.
export function previewPathSuffix(href: string): string {
  const m = href.match(/^\/preview\/\d+(\/.*)?$/);
  let path = m ? m[1] || "/" : href.startsWith("/") ? href : "/" + href;
  const drop = (p: string, re: RegExp) =>
    p.replace(re, (_all, p1: string, p2: string) => (p2 === "&" ? p1 : "")).replace(/[?&]$/, "");
  path = drop(drop(path, /([?&])t=\d+(&|$)/), /([?&])__vv_kernel=[^&#]*(&|$)/);
  return path && path !== "/" ? path : "";
}
