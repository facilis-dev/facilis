// React bindings for the covering-layer registry (issue #212): a surface marks itself while
// it is open, and anyone who must react to a covered workspace reads the same snapshot.
// Provider-free on purpose — a module-level store read through useSyncExternalStore, the
// same shape as the tour store, because covering state is app-wide and not per subtree.
import { useEffect, useSyncExternalStore } from "react";
import { blockingLayers } from "./blocking-layers";

/** Mark `id` as a covering layer for as long as `open` is true. */
export function useBlockingLayer(id: string, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    return blockingLayers.register(id);
  }, [id, open]);
}

/** Whether any covering layer is up right now. */
export function useBlockingLayersOpen(): boolean {
  return useSyncExternalStore(blockingLayers.subscribe, blockingLayers.isOpen);
}
