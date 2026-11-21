// The runtime lens's history store (issue #72, epic #56): per-route traffic facts for the
// 1/5/15-minute windows the lens offers, plus the 60-bucket sparkline. The #71 collector
// buffer only covers 5 minutes and exposes no time series, so this store accumulates the
// sample tap's data itself. Pure and clock-agnostic like the buffer: the clock only enters
// through the caller's now (ingest/tick/setLive); reads use the last observed now, so the
// module never touches Date, React or window and the node vitest can drive it directly.
//
// Memory bound: at most METRICS_MAX_ROUTES routes, each keeping the collector's own
// 1000-sample ring (so the 5-minute window is EXACTLY collector.snapshot() for the same
// now) plus at most RUNTIME_HISTORY_CAP entries spanning 15 minutes for the other windows
// and the sparkline. Under sustained load above the cap the oldest entries drop, so the
// 15-minute window may undercount; the 5-minute window stays exact because it reuses the
// ring. Views are cached per (route, window) and keep their object identity while the data
// is unchanged: useSyncExternalStore then re-renders only the routes a batch actually moved.

import { RouteRingBuffer, bucketIndexOf, statusClassOf } from "./runtime-metrics-buffer";
import { METRICS_MAX_ROUTES, type RuntimeMetricSample } from "./runtime-metrics";
import type { ProjectGraphNode } from "./graph-model";
import {
  EMPTY_VIEW,
  sameView,
  sparkFromEntries,
  statsFromEntries,
  withRate,
  type HistoryEntry,
  type RouteRuntimeView,
} from "./graph-runtime-stats";

// Re-exported so consumers import one module; the maths lives in graph-runtime-stats.ts.
export {
  EMPTY_VIEW,
  RUNTIME_HEAT_THRESHOLDS,
  RUNTIME_SPARK_BUCKETS,
  heatOf,
  type RouteRuntimeStats,
  type RouteRuntimeView,
} from "./graph-runtime-stats";

/** The lens's selectable windows, in control order; also the canonical URL order. */
export const RUNTIME_WINDOW_IDS = ["1m", "5m", "15m"] as const;
export type RuntimeWindow = (typeof RUNTIME_WINDOW_IDS)[number];
export const RUNTIME_WINDOWS_MS: Record<RuntimeWindow, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};
export const DEFAULT_RUNTIME_WINDOW: RuntimeWindow = "5m";
/** Raw entries kept per route for the 1m/15m windows and the sparkline (documented bound). */
export const RUNTIME_HISTORY_CAP = 2000;
export const RUNTIME_HISTORY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Below this zoom the runtime marks compact to the corner dot (epic rule 4). The semantic-zoom
 * machinery (#60) is not on this branch, so the runtime layer carries its own minimal threshold
 * mirroring #69's CONTRACT_COMPACT_ZOOM; #60 will subsume it.
 */
export const RUNTIME_COMPACT_ZOOM = 0.55;
export function runtimeLod(zoom: number): "chip" | "detailed" {
  return zoom < RUNTIME_COMPACT_ZOOM ? "chip" : "detailed";
}

/**
 * Canonical route template for the enable list and the store keys. The injected client compiles
 * both the analyzer's {id} and a hand-built graph's [id] spellings and echoes the template it
 * was given, so normalising to braces keeps one key per logical route across both spellings.
 */
export function normalizeRouteTemplate(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      const match = /^\[\[?(\.\.\.)?([^[\]]+?)\]?\]$/.exec(segment);
      if (match === null) return segment;
      const optional = segment.startsWith("[[");
      return "{" + (match[1] ?? "") + (match[2] ?? "") + (optional ? "?" : "") + "}";
    })
    .join("/");
}

/** Distinct route templates of the drawn view's route nodes, in first-occurrence order. */
export function routeTemplatesOf(nodes: readonly ProjectGraphNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of nodes) {
    if (node.data.kind !== "route") continue;
    const template = normalizeRouteTemplate(node.data.path);
    if (template === "" || seen.has(template)) continue;
    seen.add(template);
    out.push(template);
  }
  return out;
}

interface RouteHistory {
  ring: RouteRingBuffer;
  entries: HistoryEntry[];
  views: Map<RuntimeWindow, RouteRuntimeView>;
  dirty: boolean;
}

export class RuntimeLensStore {
  private readonly routes = new Map<string, RouteHistory>();
  private enabled: ReadonlySet<string> = new Set();
  private now = 0;
  private live = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  /** Reset the history for a (re-)activation; the route list gates ingest like the collector. */
  enable(routes: readonly string[]): void {
    this.routes.clear();
    this.enabled = new Set(routes);
    this.now = 0;
    this.live = false;
  }

  /** Live on catches the surfaces up immediately; live off freezes them on the last snapshot. */
  setLive(live: boolean, now: number): void {
    this.live = live;
    this.now = now;
    if (live) this.recompute(this.routes.keys());
  }

  /** Accumulate validated samples. History grows even when live is off; only live notifies. */
  ingest(samples: readonly RuntimeMetricSample[], now: number): void {
    this.now = now;
    const touched = new Set<string>();
    for (const sample of samples) {
      if (!this.enabled.has(sample.route)) continue;
      let history = this.routes.get(sample.route);
      if (history === undefined) {
        if (this.routes.size >= METRICS_MAX_ROUTES) continue;
        history = { ring: new RouteRingBuffer(), entries: [], views: new Map(), dirty: true };
        this.routes.set(sample.route, history);
      }
      history.ring.add(now, sample.status, sample.duration);
      history.entries.push({
        at: now,
        bucket: sample.status === 0 ? -1 : bucketIndexOf(sample.duration),
        cls: statusClassOf(sample.status),
      });
      touched.add(sample.route);
    }
    const cutoff = now - RUNTIME_HISTORY_WINDOW_MS;
    for (const route of touched) {
      const history = this.routes.get(route);
      if (history === undefined) continue;
      history.entries = history.entries.filter((entry) => entry.at >= cutoff);
      if (history.entries.length > RUNTIME_HISTORY_CAP) {
        history.entries = history.entries.slice(history.entries.length - RUNTIME_HISTORY_CAP);
      }
      history.dirty = true;
    }
    if (this.live) this.recompute(touched);
  }

  /** The live tick (window expiry, sparkline scroll) and the user-action refresh share this. */
  tick(now: number): void {
    this.now = now;
    this.recompute(this.routes.keys());
  }

  /** The cached view for a route/window; lazy and identity-stable, the useSyncExternalStore read. */
  viewFor(route: string, window: RuntimeWindow): RouteRuntimeView {
    let history = this.routes.get(route);
    if (history === undefined) {
      // Cache the empty view for enabled routes too: a card mounted before the first batch
      // must be notified when traffic arrives, which requires a cached view to refresh.
      // Uncached beyond the route cap, mirroring ingest's drop rule (memory bound).
      if (!this.enabled.has(route) || this.routes.size >= METRICS_MAX_ROUTES) return EMPTY_VIEW;
      history = { ring: new RouteRingBuffer(), entries: [], views: new Map(), dirty: false };
      this.routes.set(route, history);
    }
    if (history.dirty) {
      for (const cached of history.views.keys()) this.refreshView(history, cached);
      history.dirty = false;
    }
    const cached = history.views.get(window);
    if (cached !== undefined) return cached;
    const view = this.computeView(history, window);
    history.views.set(window, view);
    return view;
  }

  /** The subscribe/getSnapshot pair a route card binds with useSyncExternalStore. */
  routeSource(
    route: string,
    window: RuntimeWindow,
  ): {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => RouteRuntimeView;
    getServerSnapshot: () => RouteRuntimeView;
  } {
    return {
      subscribe: (listener) => this.subscribeRoute(route, listener),
      getSnapshot: () => this.viewFor(route, window),
      // The store is clock-agnostic and node-safe: the server read is the same cached view
      // (renderToStaticMarkup requires this third argument).
      getServerSnapshot: () => this.viewFor(route, window),
    };
  }

  subscribeRoute(route: string, listener: () => void): () => void {
    let set = this.listeners.get(route);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(route, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Live subscriber count for a route: the leak-check diagnostic (0 once the lens is off). */
  subscriberCount(route: string): number {
    return this.listeners.get(route)?.size ?? 0;
  }

  dispose(): void {
    this.routes.clear();
    this.listeners.clear();
    this.enabled = new Set();
    this.now = 0;
    this.live = false;
  }

  private computeView(history: RouteHistory, window: RuntimeWindow): RouteRuntimeView {
    const windowMs = RUNTIME_WINDOWS_MS[window];
    // The 5-minute window reads the collector's own ring, so its stats are exactly
    // collector.snapshot() for the same now (the acceptance criterion's equality test).
    const base =
      window === "5m"
        ? history.ring.snapshot(this.now)
        : statsFromEntries(history.entries, this.now, windowMs);
    if (base === null) return EMPTY_VIEW;
    return { stats: withRate(base), spark: sparkFromEntries(history.entries, this.now, windowMs) };
  }

  private refreshView(history: RouteHistory, window: RuntimeWindow): boolean {
    const previous = history.views.get(window);
    const next = this.computeView(history, window);
    if (previous !== undefined && sameView(previous, next)) return false;
    history.views.set(window, next);
    return true;
  }

  private recompute(routes: Iterable<string>): void {
    const changed: string[] = [];
    for (const route of routes) {
      const history = this.routes.get(route);
      if (history === undefined) continue;
      let moved = false;
      for (const window of history.views.keys()) {
        if (this.refreshView(history, window)) moved = true;
      }
      history.dirty = false;
      if (moved) changed.push(route);
    }
    for (const route of changed) {
      const set = this.listeners.get(route);
      if (set === undefined) continue;
      // Snapshot: a listener that unsubscribes mid-notify must not disturb the loop.
      for (const listener of Array.from(set)) listener();
    }
  }
}

// One store per IDE tab, the getRuntimeMetrics() pattern: the lens session owns its lifecycle
// and the cards subscribe per route; nothing else in the IDE knows it exists.
const runtimeLensStore = new RuntimeLensStore();
export function getRuntimeLensStore(): RuntimeLensStore {
  return runtimeLensStore;
}
