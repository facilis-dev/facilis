// First-run tour state, shared by the overlay (React) and the entry points that
// only need a trigger (title bar, command palette). No React or window access here:
// the storage adapter is injected so tests stay synchronous and deterministic.
import { tourStepsFor } from "./tour-steps";
import type { TourStep } from "./tour-types";

export interface TourStorage {
  get(): string | null;
  set(value: string | null): void;
}

export interface TourSnapshot {
  readonly active: boolean;
  readonly index: number;
}

export const TOUR_STORAGE_KEY = "vv.ide-tour";
/** Bumping the version makes a seen marker from an older tour replayable. */
export const TOUR_VERSION = "1";

export interface TourStore {
  subscribe(fn: () => void): () => void;
  getSnapshot(): TourSnapshot;
  start(): void;
  next(): void;
  prev(): void;
  skip(): void;
  isDone(): boolean;
}

export interface TourStoreOptions {
  /** Omitted/null means memory only; the app hands in a localStorage adapter. */
  readonly storage?: TourStorage | null;
  readonly steps?: readonly TourStep[];
}

const DEFAULT_STEPS = tourStepsFor({ chatEnabled: true });

function memoryStorage(): TourStorage {
  let value: string | null = null;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

export function createTourStore(options: TourStoreOptions = {}): TourStore {
  const storage = options.storage ?? memoryStorage();
  const steps = options.steps ?? DEFAULT_STEPS;
  const listeners = new Set<() => void>();
  let snapshot: TourSnapshot = { active: false, index: 0 };

  // useSyncExternalStore compares snapshots by identity, so a snapshot object is
  // replaced on every real transition and reused otherwise.
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const finish = (): void => {
    storage.set(TOUR_VERSION);
    if (!snapshot.active && snapshot.index === 0) return;
    snapshot = { active: false, index: 0 };
    notify();
  };

  const start = (): void => {
    // Replaying is explicit user intent: never refuse because the marker is set.
    snapshot = { active: true, index: 0 };
    notify();
  };

  const next = (): void => {
    if (!snapshot.active) return;
    if (snapshot.index >= steps.length - 1) {
      finish();
      return;
    }
    snapshot = { active: true, index: snapshot.index + 1 };
    notify();
  };

  const prev = (): void => {
    if (!snapshot.active || snapshot.index === 0) return;
    snapshot = { active: true, index: snapshot.index - 1 };
    notify();
  };

  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    start,
    next,
    prev,
    skip: finish,
    isDone: () => storage.get() === TOUR_VERSION,
  };
}

export interface AutoStartContext {
  readonly isAutomation: boolean;
  readonly tourDisabled: boolean;
}

/** Browsers driven by WebDriver/headless tools must not get an overlay on boot. */
export function isAutomationContext(
  nav: { webdriver?: boolean; userAgent?: string } | undefined,
): boolean {
  if (!nav) return false;
  return nav.webdriver === true || /HeadlessChrome/i.test(nav.userAgent ?? "");
}

export function shouldAutoStartTour(
  store: Pick<TourStore, "isDone">,
  ctx: AutoStartContext,
): boolean {
  return !store.isDone() && !ctx.isAutomation && !ctx.tourDisabled;
}
