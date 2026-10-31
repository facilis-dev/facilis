// The DevTools frontend (chii) and its relay to the per-tab chobitsu backend
// inside each preview iframe: the CDP host-page bridge, the iframe remount on
// reload, and the address-bar/title messages a preview posts back. Split out of
// controller.ts (D-019); the preview session owns the tabs and their frames.

import { toast } from "sonner";
import type { KernelBridge } from "./kernel";
import { markBoot } from "./boot-marks";
import type { PreviewHost } from "./preview-session";

/** What the DevTools relay needs from the preview session (frames + tabs). */
export interface PreviewView {
  frameFor(tabId: string): HTMLIFrameElement | undefined;
  tabIdForSource(src: MessageEventSource | null): string | null;
  syncTabLocation(id: string, href: string): void;
  setTabTitle(id: string, title: string): void;
}

export class PreviewDevtools {
  private readonly bridge: KernelBridge;
  private readonly host: PreviewHost;
  private readonly view: PreviewView;
  private devtoolsFrame: HTMLIFrameElement | null = null; // the chii frontend iframe
  private devtoolsTargetId: string | null = null; // which preview tab it is attached to

  constructor(bridge: KernelBridge, host: PreviewHost, view: PreviewView) {
    this.bridge = bridge;
    this.host = host;
    this.view = view;
  }

  /** DevTools closed with its tab: forget the target (the caller hides the panel). */
  reset() {
    this.devtoolsTargetId = null;
  }

  /** DevTools follows the active preview tab. Called on every snapshot patch:
   *  when the active tab changed while the panel is open, re-attach to the new
   *  target or close the panel with the last tab. Returns the patch to apply —
   *  the caller mutates its own store, so this never re-enters it. */
  followActive(
    prevActive: string | null,
  ): { devtoolsOpen?: boolean; devtoolsNonce?: number } | null {
    const { devtoolsOpen, activeId } = this.host.state();
    if (!devtoolsOpen || activeId === prevActive) return null;
    if (activeId == null) {
      this.devtoolsTargetId = null;
      return { devtoolsOpen: false };
    }
    if (activeId === this.devtoolsTargetId) return null;
    this.devtoolsTargetId = activeId;
    return { devtoolsNonce: this.host.state().devtoolsNonce + 1 };
  }

  setDevtoolsFrame(el: HTMLIFrameElement | null) {
    this.devtoolsFrame = el;
  }
  // The chii frontend URL: local host page + `#?embedded=<origin>` flips chii into
  // its postMessage transport (chii reads `location.search || location.hash`, so the
  // param MUST live in the hash — a `?query` cache-bust would shadow it and break the
  // transport). Re-attach reload is handled by remounting the iframe (React `key`).
  devtoolsSrc(): string {
    return `/devtools-host.html#?embedded=${encodeURIComponent(location.origin)}`;
  }
  toggleDevtools() {
    if (this.host.state().devtoolsOpen) this.closeDevtools();
    else this.openDevtools();
  }
  openDevtools() {
    if (!this.host.state().activeId) {
      toast.error("Open a preview tab first");
      return;
    }
    this.devtoolsTargetId = this.host.state().activeId;
    this.host.update({ devtoolsOpen: true, devtoolsNonce: this.host.state().devtoolsNonce + 1 });
  }
  closeDevtools() {
    this.devtoolsTargetId = null;
    this.host.update({ devtoolsOpen: false });
  }
  // Called when the DevTools frontend iframe finishes loading — kick the target's
  // chobitsu into replaying the page state (frameNavigated + domain enables).
  onDevtoolsReady() {
    if (!this.host.state().devtoolsOpen || !this.devtoolsTargetId) return;
    const target = this.view.frameFor(this.devtoolsTargetId);
    target?.contentWindow?.postMessage({ source: "vv-cdp", dir: "init" }, "*");
  }

  onPreviewFrameLoad(id: string) {
    // Only a tab bound to a real port counts as the app appearing; an empty tab
    // loads `about:blank` and would otherwise mark the timeline far too early.
    if (this.host.state().tabs.find((t) => t.id === id)?.port != null) {
      markBoot("preview-paint");
      // There is something to look at now, so stop narrating.
      this.host.endRunPhase();
    }
    // Sync the address bar from the frame's real URL on every load. The vv-nav
    // script only rides in HTML responses, so navigating to a non-HTML endpoint
    // (a JSON API, a file, an image) never reports its path and the address bar
    // would go stale. Same-origin (mode A) lets us read the location directly;
    // cross-origin previews (mode B/C) throw here and keep relying on vv-nav for
    // HTML pages.
    if (this.bridge.mode === "same-origin") {
      try {
        const loc = this.view.frameFor(id)?.contentWindow?.location;
        if (loc) this.view.syncTabLocation(id, loc.pathname + loc.search);
      } catch {
        /* cross-origin frame — rely on the injected vv-nav script */
      }
    }
    if (!this.host.state().devtoolsOpen || this.devtoolsTargetId !== id) return;
    const tab = this.host.state().tabs.find((t) => t.id === id);
    if (!tab || tab.port == null) return;
    this.host.update({ devtoolsNonce: this.host.state().devtoolsNonce + 1 });
  }

  // The host-page relay: bridges CDP between each preview tab's chobitsu and the
  // shared chii frontend, and syncs the address bar from in-app navigation.
  wireMessages() {
    // Preview frames are cross-origin in modes B/C; only trust their messages from
    // a recognised preview origin (mode A: same-origin as the studio; mode B: the
    // single preview origin; mode C: any `<token>--<port>.<domain>` host).
    const here = typeof location !== "undefined" ? location.origin : "";
    const trustPreviewOrigin = (origin: string) =>
      this.bridge.mode === "same-origin"
        ? origin === here
        : this.bridge.isTrustedPreviewOrigin(origin);
    window.addEventListener("message", (event: MessageEvent) => {
      const src = event.source;
      const data = event.data;

      // DevTools frontend → target tab. chii posts raw CDP JSON strings. The
      // frontend is always same-origin (served by the studio), so guard it so.
      if (this.devtoolsFrame && src && src === this.devtoolsFrame.contentWindow) {
        if (event.origin !== location.origin) return;
        if (typeof data !== "string") return;
        const target = this.devtoolsTargetId ? this.view.frameFor(this.devtoolsTargetId) : null;
        target?.contentWindow?.postMessage({ source: "vv-cdp", dir: "frontend", data }, "*");
        return;
      }

      if (!data || typeof data !== "object") return;
      // Everything below originates from a preview frame — enforce its origin.
      if (!trustPreviewOrigin(event.origin)) return;

      // Preview tab's chobitsu → frontend (only if this tab is the attached target).
      if (data.source === "vv-cdp" && data.dir === "target") {
        const tabId = this.view.tabIdForSource(src);
        if (tabId && tabId === this.devtoolsTargetId) {
          this.devtoolsFrame?.contentWindow?.postMessage(data.data, "*");
        }
        return;
      }

      // Preview tab navigated (link click / SPA route) → sync the address bar.
      if (data.source === "vv-nav") {
        const tabId = this.view.tabIdForSource(src);
        if (tabId) this.view.syncTabLocation(tabId, String(data.href || "/"));
        return;
      }

      // Preview reported its document.title → show it on the tab.
      if (data.source === "vv-title") {
        const tabId = this.view.tabIdForSource(src);
        if (tabId)
          this.view.setTabTitle(tabId, typeof data.title === "string" ? data.title.trim() : "");
      }
    });
  }
}
