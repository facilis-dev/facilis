// The Preview panel: a multi-tab mini browser over the in-VM dev servers.
// Split out of controller.ts (D-019); the controller owns the snapshot, the
// project/port bookkeeping and the status bar this session reports to.

import { toast } from "sonner";
import type { KernelBridge } from "./kernel";
import { markBoot } from "./boot-marks";
import { PreviewCdp } from "./preview-cdp";
import { openPreviewWindow } from "./preview-popout";
import { closedOtherTabs, closedTab, closedTabsToRight } from "./preview-tabs";
import { parsePreviewAddress, previewPathSuffix, previewSrcFor } from "./preview-url";
import { PreviewDevtools } from "./preview-devtools";

// One browser tab in the Preview panel.
export interface PreviewTab {
  id: string;
  url: string; // editable address-bar text (what the user sees / types)
  port: number | null; // the in-VM dev-server port this tab mirrors (null = empty tab)
  path: string; // the request path within the dev server (starts with "/")
  nonce: number; // per-tab reload counter (bump to force the iframe to reload)
  title?: string; // the running app's real document.title (reported by the preview)
}

/** The slice of the IDE snapshot the Preview panel owns. */
export interface PreviewState {
  tabs: PreviewTab[];
  activeId: string | null;
  devtoolsOpen: boolean;
  devtoolsNonce: number;
}

/** What the preview needs from the controller. */
export interface PreviewHost {
  state(): PreviewState;
  /** Apply a partial change to the fields above (+ the panel's collapsed flag,
   *  which a newly opened tab un-hides). */
  update(patch: {
    tabs?: PreviewTab[];
    activeId?: string | null;
    devtoolsOpen?: boolean;
    devtoolsNonce?: number;
    previewCollapsed?: boolean;
  }): void;
  /** Ports that serve UNDER /preview/<port>/ (keep-prefix templates). */
  keepPrefixPorts(): number[];
  /** A transient status-bar message. */
  status(text: string): void;
  /** The app painted: stop narrating the run. */
  endRunPhase(): void;
}

export class PreviewSession {
  readonly devtools: PreviewDevtools;
  /** Programmatic CDP against the running preview (D-111): the AI tools drive the app. */
  readonly cdp: PreviewCdp;
  private readonly bridge: KernelBridge;
  private readonly host: PreviewHost;
  private frames = new Map<string, HTMLIFrameElement>(); // preview tab id -> iframe
  private seq = 0;

  constructor(bridge: KernelBridge, host: PreviewHost) {
    this.bridge = bridge;
    this.host = host;
    this.cdp = new PreviewCdp({
      active: () => this.activePreviewTab(),
      frame: (tabId) => this.frames.get(tabId),
    });
    this.devtools = new PreviewDevtools(bridge, host, this);
  }

  /** The tab the preview tools and DevTools follow: the active one, else the first with a port. */
  activePreviewTab(): PreviewTab | null {
    const active = this.state.tabs.find((tab) => tab.id === this.state.activeId);
    if (active !== undefined && active.port !== null) return active;
    return this.state.tabs.find((tab) => tab.port !== null) ?? null;
  }

  /** Navigate the preview to a project route (D-111): a full reload on the new path. */
  navigatePreviewPath(id: string, path: string): void {
    const tab = this.state.tabs.find((entry) => entry.id === id);
    if (tab === undefined || tab.port === null || !path.startsWith("/")) return;
    this.setTab(id, { path, nonce: tab.nonce + 1, title: "" });
  }

  /** The DevTools relay hands every preview CDP target message to the programmatic client. */
  onCdpTarget(tabId: string, data: unknown): void {
    this.cdp.dispatch(tabId, data);
  }

  private get state(): PreviewState {
    return this.host.state();
  }

  /** Attach the host-page message relay (DevTools CDP + address-bar sync). */
  wireMessages() {
    this.devtools.wireMessages();
  }

  /** A preview iframe finished (re)loading: paint mark, address bar, DevTools, CDP session. */
  onPreviewFrameLoad(id: string) {
    this.cdp.onFrameLoad(id);
    this.devtools.onPreviewFrameLoad(id);
  }

  /** The iframe a tab is mounted in (the DevTools relay posts into it). */
  frameFor(tabId: string): HTMLIFrameElement | undefined {
    return this.frames.get(tabId);
  }

  /** Update a tab's displayed title (reported by the preview document). */
  setTabTitle(id: string, title: string) {
    this.setTab(id, { title });
  }

  // Route a kernel -> preview ws/SSE frame to every iframe bound to a dev
  // server, then to any pop-outs (COOP severs their handle; the SW broadcasts
  // to them and each shim keeps only the connIds it owns).
  relayFrame(payload: object) {
    for (const t of this.state.tabs) {
      if (t.port != null) this.frames.get(t.id)?.contentWindow?.postMessage(payload, "*");
    }
    this.relayToExternalPreviews(payload);
  }

  setPreviewFrame(id: string, el: HTMLIFrameElement | null) {
    if (el) {
      this.frames.set(id, el);
    } else {
      this.frames.delete(id);
      this.cdp.forget(id);
    }
  }
  // The iframe URL for a tab (pure, preview-url.ts).
  previewSrc(tab: PreviewTab): string {
    return previewSrcFor(this.bridge, tab);
  }
  private setTab(id: string, patch: Partial<PreviewTab>) {
    this.host.update({
      tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  // A demo's dev server is up — reuse the tab that already mirrors this port, or
  // open one, and make it active.
  /** A demo/project dev server came up: mirror it in a preview tab. */
  pointPreview(port: number) {
    markBoot("preview-open");
    const existing = this.state.tabs.find((t) => t.port === port);
    if (existing) {
      this.setTab(existing.id, { nonce: existing.nonce + 1, title: "" });
      this.host.update({ activeId: existing.id });
      return;
    }
    const id = "pv" + ++this.seq;
    const tab: PreviewTab = { id, url: `localhost:${port}`, port, path: "/", nonce: 1 };
    // Reveal the preview the way spawning a terminal reveals the bottom panel: this
    // is the one path that can add a tab while the panel is hidden, and a dev server
    // coming up with nothing to show for it is a dead end. Only for a genuinely new
    // port — a restart on a port we already mirror takes the branch above.
    this.host.update({
      tabs: [...this.state.tabs, tab],
      activeId: id,
      previewCollapsed: false,
    });
  }

  /** Reload every tab mirroring `port` (a dev server restarted). */
  reloadPort(port: number) {
    for (const t of this.state.tabs) if (t.port === port) this.reloadPreviewTab(t.id);
  }

  // Push the set of in-VM ports that serve UNDER the /preview/<port>/ prefix
  // (keep-prefix templates) to the preview Service Worker, so it doesn't strip the
  // prefix for them. Recomputed from the live run manifests whenever a project's
  // server starts or stops.
  /** Recomputed by the controller when a project's server starts/stops. */
  syncKeepPrefixPorts() {
    this.bridge.setKeepPrefixPorts(this.host.keepPrefixPorts());
  }

  /** Open a tab on an address and in-server path; returns the new id. */
  addPreviewTab(url = "", path = "/"): string {
    const id = "pv" + ++this.seq;
    const tab: PreviewTab = { id, url, port: null, path, nonce: 1 };
    this.host.update({ tabs: [...this.state.tabs, tab], activeId: id });
    return id;
  }
  /** Point an unbound tab at an in-server path (bound tabs use navigatePreviewPath). */
  setPreviewPath(id: string, path: string) {
    const tab = this.state.tabs.find((entry) => entry.id === id);
    if (tab?.port === null && path.startsWith("/")) this.setTab(id, { path });
  }
  activatePreviewTab(id: string) {
    this.host.update({ activeId: id });
  }
  // Live edits to the address-bar text (does not navigate — Enter does that).
  setPreviewUrl(id: string, url: string) {
    this.setTab(id, { url });
  }

  // Navigate a tab to a typed address (parsing in preview-url.ts).
  navigatePreview(id: string, input: string) {
    const tab = this.state.tabs.find((t) => t.id === id);
    if (!tab) return;
    const parsed = parsePreviewAddress(tab.port, input);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    this.setTab(id, { ...parsed.address, nonce: tab.nonce + 1, title: "" });
  }
  reloadPreviewTab(id: string) {
    const t = this.state.tabs.find((x) => x.id === id);
    if (!t) return;
    // Reload the *current* in-app location natively (keeps the SPA route + re-runs
    // the SW HTML injection). Fall back to a src cache-bust if the frame is gone.
    const frame = this.frames.get(id);
    if (t.port != null && frame?.contentWindow) {
      try {
        frame.contentWindow.location.reload();
        return;
      } catch {
        /* cross-origin / detached — fall through to the src bump */
      }
    }
    this.setTab(id, { nonce: t.nonce + 1 });
  }
  reloadPreview() {
    if (this.state.activeId) this.reloadPreviewTab(this.state.activeId);
  }
  previewBack(id: string) {
    try {
      this.frames.get(id)?.contentWindow?.history.back();
    } catch {
      /* cross-origin */
    }
  }
  previewForward(id: string) {
    try {
      this.frames.get(id)?.contentWindow?.history.forward();
    } catch {
      /* cross-origin */
    }
  }
  openPreviewExternal(id: string) {
    const tab = this.state.tabs.find((entry) => entry.id === id);
    if (tab?.port != null) openPreviewWindow(this.bridge, tab.port);
  }

  openExternalPreview(port: number) {
    openPreviewWindow(this.bridge, port);
  }

  // Relay an inbound ws/SSE frame to any preview opened in its OWN tab. Those tabs
  // can't be reached by postMessage (COOP severs the handle), so hand the frame to
  // the Service Worker(s), which broadcast it to every top-level preview client;
  // each shim keeps only the connIds it owns. A pop-out may be same-origin OR on
  // the preview origin, so relay to both transports (bridge.broadcastToPreviewSWs).
  private relayToExternalPreviews(payload: object) {
    this.bridge.broadcastToPreviewSWs(payload);
  }

  closePreviewTab(id: string) {
    const update = closedTab(this.state.tabs, this.state.activeId, id);
    if (update === null) return;
    this.frames.delete(id);
    this.host.update(update);
  }
  /** Close every tab mirroring `port`: its dev server went with the project that owned it. */
  closePortTabs(port: number) {
    for (const tab of this.state.tabs.filter((entry) => entry.port === port)) {
      this.closePreviewTab(tab.id);
    }
  }
  closeOtherPreviewTabs(id: string) {
    this.host.update(closedOtherTabs(this.state.tabs, id));
  }
  closePreviewTabsToRight(id: string) {
    const update = closedTabsToRight(this.state.tabs, this.state.activeId, id);
    if (update !== null) this.host.update(update);
  }
  closeAllPreviewTabs() {
    for (const tab of this.state.tabs) this.cdp.forget(tab.id);
    this.frames.clear();
    this.devtools.reset();
    this.host.update({ tabs: [], activeId: null, devtoolsOpen: false });
  }

  tabIdForSource(src: MessageEventSource | null): string | null {
    if (!src) return null;
    for (const [id, el] of this.frames) {
      if (el.contentWindow === src) return id;
    }
    return null;
  }

  // Update a tab's displayed address from an in-app navigation. Display only — it
  // must NOT touch `path` (which drives previewSrc), or React would reload the
  // iframe on every SPA route change (a navigation loop).
  syncTabLocation(id: string, href: string) {
    const tab = this.state.tabs.find((t) => t.id === id);
    if (!tab || tab.port == null) return;
    // Strip the /preview/<port>/ prefix, the cache-bust and the kernel token (preview-url.ts).
    this.setTab(id, { url: `localhost:${tab.port}${previewPathSuffix(href)}` });
  }
}
