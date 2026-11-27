// The source lifecycle of a graph lens (D-224 §4, #198). A lens is draw state; its source is
// not: a live, workspace or declared lens must be enabled when its lens opens and dropped when
// it closes, switches, unmounts or the project changes. `static` has no adapter, so the analyzer
// lenses stay a pure filter over facts the panel already holds.

import type { MessageKey } from "@/i18n";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphLensDefinition, GraphLensId, GraphLensSource } from "./lenses.ts";
import { GRAPH_LENSES } from "./lenses-registry.ts";
import type { GraphLensState } from "./state-facts.ts";

/** Whether a source can serve a lens right now; unavailable always carries a reason code. */
export interface GraphLensAvailability {
  readonly available: boolean;
  readonly reasonKey: MessageKey | null;
}

export const LENS_AVAILABLE: GraphLensAvailability = { available: true, reasonKey: null };

/** What a source needs from the surface at activation: the drawn graph. */
export interface GraphLensContext {
  readonly view: ProjectGraphView | null;
}

export interface GraphLensSourceAdapter {
  readonly source: GraphLensSource;
  readonly activate: (lens: GraphLensId, context: GraphLensContext) => void;
  readonly deactivate: (lens: GraphLensId) => void;
  /** Omitted means "always available"; a live source returns its own code when it cannot run. */
  readonly availability?: (lens: GraphLensId) => GraphLensAvailability;
  /** The lens's facts right now; null for a static source (analyzer diagnostics instead). */
  readonly state?: (lens: GraphLensId, context: GraphLensContext) => GraphLensState | null;
  /** The source changed (a batch arrived): repaint. Omitted means never. */
  readonly subscribe?: (listener: () => void) => () => void;
}

export interface GraphLensLifecycle {
  /** The lens whose source is on; null when no lens is open. */
  readonly active: GraphLensId | null;
  /** Idempotent: applying the lens already active runs no hook. */
  readonly apply: (lens: GraphLensId | null, context?: GraphLensContext) => void;
  /** Close whatever is open (surface unmount, project change). */
  readonly dispose: () => void;
  readonly availabilityOf: (lens: GraphLensId) => GraphLensAvailability;
  readonly stateOf: (lens: GraphLensId, context: GraphLensContext) => GraphLensState | null;
  /** Returns the unsubscribe function; a source with no subscription is a no-op. */
  readonly subscribe: (lens: GraphLensId, listener: () => void) => () => void;
}

/**
 * `descriptors` is the registry the lifecycle reads sources from; it is a parameter so a source
 * adapter can be exercised before the first live lens ships.
 */
export function createGraphLensLifecycle(
  adapters: readonly GraphLensSourceAdapter[] = [],
  descriptors: readonly GraphLensDefinition[] = GRAPH_LENSES,
): GraphLensLifecycle {
  const bySource = new Map(adapters.map((adapter) => [adapter.source, adapter] as const));
  const sourceOf = (lens: GraphLensId): GraphLensSource => {
    const definition = descriptors.find((entry) => entry.id === lens);
    // A lens the registry does not describe is a programming error, not a runtime condition.
    if (definition === undefined) throw new Error("No descriptor for lens " + lens);
    return definition.source;
  };
  const adapterFor = (lens: GraphLensId): GraphLensSourceAdapter | null =>
    bySource.get(sourceOf(lens)) ?? null;
  let active: GraphLensId | null = null;
  const apply = (next: GraphLensId | null, context: GraphLensContext = { view: null }): void => {
    if (next === active) return;
    if (active !== null) adapterFor(active)?.deactivate(active);
    active = next;
    if (next !== null) adapterFor(next)?.activate(next, context);
  };
  return {
    get active() {
      return active;
    },
    apply,
    dispose: () => apply(null),
    availabilityOf: (lens) => adapterFor(lens)?.availability?.(lens) ?? LENS_AVAILABLE,
    stateOf: (lens, context) => adapterFor(lens)?.state?.(lens, context) ?? null,
    subscribe: (lens, listener) => adapterFor(lens)?.subscribe?.(listener) ?? (() => {}),
  };
}
