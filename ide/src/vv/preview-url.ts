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

// The iframe URL for a preview tab: the SW preview proxy for a bound port, else
// blank. The in-server path plus a per-tab cache-bust force a fresh document on
// reload/navigate (the SW re-injects the WS shim + DevTools bootstrap each time).
export function previewSrcFor(
  bridge: KernelBridge,
  tab: { port: number | null; path: string; nonce: number },
): string {
  if (tab.port == null) return "about:blank";
  const path = tab.path && tab.path.startsWith("/") ? tab.path : "/";
  const bust = tab.nonce > 1 ? `${path.includes("?") ? "&" : "?"}t=${tab.nonce}` : "";
  // The bridge builds the right URL per mode: relative `/preview/<port>/...` in
  // mode A, `<origin>/preview/<port>/...` in mode B, or a per-port wildcard origin
  // `<scheme>//<token>--<port>.<domain>/...` (served at root) in mode C.
  return bridge.previewUrlFor(tab.port, `${path}${bust}`);
}

/** The tab fields a typed address-bar entry maps to, plus the text to display. */
export interface PreviewAddress {
  url: string;
  port: number;
  path: string; // starts with "/"
}

/** Parse an address-bar entry against the tab's current port. Local-only for
 *  now: localhost / 127.0.0.1, a bare port, or a bare path; everything else is
 *  refused rather than guessed. The caller toasts the error text. */
export function parsePreviewAddress(
  currentPort: number | null,
  input: string,
): { address: PreviewAddress } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Enter a local port, e.g. localhost:3000" };

  // Strip an optional scheme, then split host[:port] from the path.
  const noScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  let hostPort = noScheme;
  let path = "/";
  const slash = noScheme.indexOf("/");
  if (noScheme.startsWith("/")) {
    // Bare path — keep the tab's current port.
    hostPort = "";
    path = noScheme;
  } else if (slash !== -1) {
    hostPort = noScheme.slice(0, slash);
    path = noScheme.slice(slash);
  }

  let port = currentPort;
  if (/^\d+$/.test(hostPort)) {
    // Bare port, e.g. "3000".
    port = parseInt(hostPort, 10);
  } else if (hostPort) {
    const [host, portStr] = hostPort.split(":");
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
    if (!isLocal) return { error: "Only local URLs are supported for now" };
    if (portStr) port = parseInt(portStr, 10);
  }
  if (port == null || Number.isNaN(port))
    return { error: "Enter a local port, e.g. localhost:3000" };
  if (!path.startsWith("/")) path = "/" + path;

  return {
    address: {
      url: `localhost:${port}${path === "/" ? "" : path}`,
      port,
      path,
    },
  };
}
