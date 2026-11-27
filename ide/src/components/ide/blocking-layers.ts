// The covering-layer registry (issue #212, reused by #217): the ids of the surfaces that
// cover the workspace — Home today, the tour, the boot/share overlays and the fullscreen
// graph next. Pure data plus a listener set: no React, no DOM, so the rules are unit-tested
// and every consumer reads one stack instead of keeping its own flag. The shortcut gate
// stays the overlay marker (see shortcut-focus.ts); this is the state that lets a surface
// say "I am up" without importing the shell.
export interface BlockingLayers {
  /** Add `id` to the stack; the returned function removes it again (for effect cleanups). */
  register(id: string): () => void;
  unregister(id: string): void;
  isOpen(): boolean;
  /** Notified on every real transition (first layer up, last layer down), never twice. */
  subscribe(listener: () => void): () => void;
}

export function createBlockingLayers(): BlockingLayers {
  const open = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const remove = (id: string): void => {
    if (!open.delete(id)) return;
    notify();
  };
  return {
    register: (id) => {
      // Idempotent: StrictMode's second mount and a re-registered surface must not make a
      // duplicate entry or a spurious notify.
      if (!open.has(id)) {
        open.add(id);
        notify();
      }
      return () => remove(id);
    },
    unregister: remove,
    isOpen: () => open.size > 0,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One IDE shell, one layer stack. */
export const blockingLayers = createBlockingLayers();

/** Whether a covering layer is up right now, for callers outside React. */
export function isBlockingLayerOpen(): boolean {
  return blockingLayers.isOpen();
}
