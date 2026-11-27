// The project graph's lens state (D-220, #189; registry and lifecycle #198; runtime lens
// #199), split from the panel to keep both under the 300-line source limit. Lenses are draw
// state only: opening one activates its source through the lifecycle, so a live source runs
// only while somebody is watching (D-224 §4). Static lenses never leave this hook's memoized
// filter.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphDiagnostic, GraphDiagnosticCode } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  createGraphLensLifecycle,
  type GraphLensAvailability,
  type GraphLensSourceAdapter,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import {
  createChangesLensSource,
  type ChangesLensController,
} from "@/facilis/graph-surface/changes-lens-source.ts";
import {
  createRuntimeLensSource,
  type RuntimeLensController,
} from "@/facilis/graph-surface/runtime-lens-source.ts";
import { lensDefinition } from "@/facilis/graph-surface/lenses-registry.ts";
import {
  diagnosticsByNode,
  lensHighlight,
  summarizeLens,
  type GraphLensHighlight,
  type GraphLensId,
} from "@/facilis/graph-surface/lenses.ts";
import type { GraphLensState, GraphLensView } from "@/facilis/graph-surface/state-facts.ts";

const NO_DIAGNOSTICS: readonly GraphDiagnostic[] = [];

/** The controller surface both live/workspace sources read. */
export interface GraphLensController extends RuntimeLensController, ChangesLensController {}

interface LensSelection {
  readonly lens: GraphLensId;
  /** The project the lens was opened on: a state lens never leaks across projects. */
  readonly projectKey: string | null;
}

export interface ProjectGraphLensState {
  readonly lens: GraphLensId | null;
  readonly view: GraphLensView | null;
  readonly highlight: GraphLensHighlight | null;
  readonly byNode: ReadonlyMap<string, readonly GraphDiagnostic[]>;
  readonly availabilityOf: (lens: GraphLensId) => GraphLensAvailability;
  readonly selectLens: (lens: GraphLensId) => void;
  readonly closeLens: () => void;
}

export function useProjectGraphLens(
  diagnostics: readonly GraphDiagnostic[] | undefined,
  view: ProjectGraphView | null,
  projectKey: string | null = null,
  controller: GraphLensController | null = null,
): ProjectGraphLensState {
  const adapters = useMemo<readonly GraphLensSourceAdapter[]>(
    () =>
      controller === null
        ? []
        : [createRuntimeLensSource(controller), createChangesLensSource(controller)],
    [controller],
  );
  const lifecycle = useMemo(() => createGraphLensLifecycle(adapters), [adapters]);
  const [selection, setSelection] = useState<LensSelection | null>(null);
  // Derived, not reset in an effect: changing project closes the lens in the same render, so no
  // frame ever shows the previous project's source or summary.
  const lens = selection !== null && selection.projectKey === projectKey ? selection.lens : null;
  // ...and the selection itself is dropped, so returning to the previous project does not revive
  // a lens whose buffer was already dropped on deactivation.
  useEffect(() => {
    setSelection(null);
  }, [projectKey]);
  useEffect(() => {
    lifecycle.apply(lens, { view });
  }, [lifecycle, lens, view]);
  useEffect(() => () => lifecycle.dispose(), [lifecycle]);
  // A live source notifies when a batch lands: pull its window into state, so a repaint sees
  // fresh numbers and a static lens never re-renders for a source it does not have.
  const [state, setState] = useState<GraphLensState | null>(null);
  useEffect(() => {
    if (lens === null) {
      setState(null);
      return undefined;
    }
    const refresh = (): void => setState(lifecycle.stateOf(lens, { view }));
    refresh();
    return lifecycle.subscribe(lens, refresh);
  }, [lifecycle, lens, view]);
  // A lens answer must be navigable: keep only nodes the current view actually draws.
  const facts = useMemo(() => {
    if (diagnostics === undefined || view === null) return NO_DIAGNOSTICS;
    const visible = new Set(view.nodes.map((node) => node.id));
    return diagnostics.filter((entry) => visible.has(entry.nodeId));
  }, [diagnostics, view]);
  const byNode = useMemo(() => diagnosticsByNode(facts), [facts]);
  const definition = lens === null ? null : lensDefinition(lens);
  const summary = useMemo(
    () => (lens === null || definition?.source !== "static" ? null : summarizeLens(lens, facts)),
    [lens, definition, facts],
  );
  const lensView = useMemo<GraphLensView | null>(() => {
    if (lens === null) return null;
    if (summary !== null) return { kind: "diagnostics", summary };
    return state === null ? null : { kind: "state", state };
  }, [lens, summary, state]);
  const highlight = useMemo<GraphLensHighlight | null>(() => {
    if (lensView === null) return null;
    if (lensView.kind === "diagnostics") return lensHighlight(lensView.summary);
    return {
      flagged: new Set(lensView.state.badges.keys()),
      codeOf: new Map<string, GraphDiagnosticCode>(),
      badges: lensView.state.badges,
    };
  }, [lensView]);
  const selectLens = useCallback(
    (next: GraphLensId) => {
      setSelection((current) =>
        current !== null && current.lens === next && current.projectKey === projectKey
          ? null
          : { lens: next, projectKey },
      );
    },
    [projectKey],
  );
  const closeLens = useCallback(() => setSelection(null), []);
  return {
    lens,
    view: lensView,
    highlight,
    byNode,
    availabilityOf: lifecycle.availabilityOf,
    selectLens,
    closeLens,
  };
}
