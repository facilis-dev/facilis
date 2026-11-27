// A palette or picker request for one graph lens (issue #204). The active lens is the panel's
// draw state, so the request is a one-shot intent, not a second store: the panel's hook applies
// it through the same selectLens the chips call, which toggles the active lens off and switches
// to another — D-224's lifecycle stays in one place. A request made before the panel mounts is
// kept and replayed once to the first subscriber; a request delivered to an open panel is not.

import type { GraphLensId } from "./lenses.ts";

type Listener = (lens: GraphLensId) => void;

const listeners = new Set<Listener>();
let pending: GraphLensId | null = null;

function deliver(lens: GraphLensId): void {
  for (const listener of Array.from(listeners)) listener(lens);
}

/** Ask the open (or next) graph panel to toggle this lens, exactly as its chip would. */
export function requestGraphLens(lens: GraphLensId): void {
  if (listeners.size > 0) {
    deliver(lens);
    return;
  }
  pending = lens;
}

/** Subscribe the panel; a request made while it was closed is replayed once. */
export function subscribeGraphLensRequests(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const lens = pending;
    pending = null;
    listener(lens);
  }
  return () => {
    listeners.delete(listener);
  };
}
