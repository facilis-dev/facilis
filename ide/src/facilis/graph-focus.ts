// The AI graph tools ask the open project-graph panel to focus nodes/edges (D-171).
//
// The request is module state, not a controller callback: the panel unmounts with its editor tab,
// so a tool call made while the graph is closed must survive until the next mount. The last
// request is kept and replayed once to the next subscriber, then cleared: two tool calls in a row
// only replay the newest one, which is the state the canvas should show anyway.

/** What the canvas focuses: node/edge ids from the visible view, and whether to fit the viewport. */
export interface GraphFocusRequest {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
  readonly zoom: boolean;
}

type Listener = (request: GraphFocusRequest) => void;

const listeners = new Set<Listener>();
let pending: GraphFocusRequest | null = null;

function deliver(request: GraphFocusRequest): void {
  // Snapshot: a listener that unsubscribes mid-notify must not disturb the loop.
  for (const listener of Array.from(listeners)) listener(request);
}

/** Ask the panel to focus these ids; the IDE opens the graph tab before calling this. */
export function notifyGraphFocus(request: GraphFocusRequest): void {
  pending = request;
  deliver(request);
}

/**
 * Clear the canvas focus: an empty request is how the panel learns to stop dimming, and it
 * resolves to null in focusStateFrom. The pending request is dropped instead of replaced, so a
 * focus announced while the graph tab was closed cannot replay after the user dismissed it.
 */
export function clearGraphFocus(): void {
  pending = null;
  deliver({ nodes: [], edges: [], zoom: false });
}

/**
 * Subscribe the open panel. A pending request is delivered once and cleared, so a focus created
 * while the graph tab was closed still lands when the panel mounts.
 */
export function subscribeGraphFocus(listener: Listener): () => void {
  listeners.add(listener);
  if (pending !== null) {
    const request = pending;
    pending = null;
    listener(request);
  }
  return () => {
    listeners.delete(listener);
  };
}
