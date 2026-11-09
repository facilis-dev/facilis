// A tiny module-level event for "the graph state on disk changed outside the panel" (D-126).
//
// The AI graph tools write the state files through graph-layout.ts directly; the open panel
// listens here so the canvas reflects the AI's arrangement without a reload. One listener
// today (the panel), but the event is the seam, not a controller callback: the tools do not
// own the panel and the panel does not own the tools.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Returns the unsubscribe function (use it as the effect cleanup). */
export function subscribeGraphLayoutChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyGraphLayoutChanged(): void {
  // Snapshot: a listener that unsubscribes (or subscribes) mid-notify must not disturb the loop.
  for (const listener of Array.from(listeners)) listener();
}
