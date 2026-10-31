// The Studio's "reset everything" clean slate.
//
// Clearing a browser's cached files does NOT unregister a Service Worker, and it does
// not touch CacheStorage or OPFS. A worker left registered keeps controlling this
// origin — and keeps answering /preview/… with the previous build's routing — until it
// is explicitly unregistered, so a reset that skipped it is not a reset. That is why
// "Reset everything" owns all three pieces of per-origin state: the OPFS VFS mirror +
// dependency cache (core's resetVfs), every Service Worker registration, and
// CacheStorage (the preview worker's `vv-config`, plus `vv-precache-*` on a built studio).
//
// Best-effort by construction: one target failing never blocks the others, because the
// caller reloads regardless and a clean slate is what matters, not a full report.
// Targets are injectable so the behaviour is testable without a browser
// (origin-reset.test.ts).

export interface ServiceWorkerRegistrationLike {
  unregister(): Promise<boolean>;
}

export interface OriginResetTargets {
  /** Wipe the OPFS-mirrored VFS + the dependency cache. Defaults to core's resetVfs(). */
  wipeVfs?: () => Promise<unknown>;
  /** Every Service Worker registration on this origin. */
  registrations?: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
  /** CacheStorage keys on this origin. */
  cacheKeys?: () => Promise<string[]>;
  /** Delete one CacheStorage entry. */
  deleteCache?: (key: string) => Promise<unknown>;
}

function defaultTargets(): Required<OriginResetTargets> {
  return {
    // Imported lazily: @vivari/core pulls in the browser bridges, and this module is
    // imported by a Node test that only supplies fakes.
    wipeVfs: async () => (await import("@vivari/core")).resetVfs(),
    registrations: async () => {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return [];
      return navigator.serviceWorker.getRegistrations();
    },
    cacheKeys: async () => (typeof caches === "undefined" ? [] : caches.keys()),
    deleteCache: async (key) => (typeof caches === "undefined" ? false : caches.delete(key)),
  };
}

/**
 * Tear down every piece of per-origin state the Studio owns. Never throws: each target
 * is best-effort, so the caller's reload always happens even when one API is unavailable.
 */
export async function resetOriginState(targets: OriginResetTargets = {}): Promise<void> {
  const resolved = { ...defaultTargets(), ...targets };
  await Promise.allSettled([
    resolved.wipeVfs(),
    resolved
      .registrations()
      .then((registrations) =>
        Promise.allSettled(registrations.map((registration) => registration.unregister())),
      ),
    resolved
      .cacheKeys()
      .then((keys) => Promise.allSettled(keys.map((key) => resolved.deleteCache(key)))),
  ]);
}
