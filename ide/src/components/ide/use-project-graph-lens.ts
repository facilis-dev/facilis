// The project graph's lens state (D-220, #189; registry and lifecycle #198), split from the
// panel to keep both under the 300-line source limit. Lenses are draw state only: this hook never
// touches the layout, the saved positions or the camera, and every derived value is memoized on
// the analyzer facts. Opening a lens activates its source through the lifecycle, so a live source
// runs only while somebody is watching (D-224 §4).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphDiagnostic } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  createGraphLensLifecycle,
  type GraphLensAvailability,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import {
  diagnosticsByNode,
  lensHighlight,
  summarizeLens,
  type GraphLensHighlight,
  type GraphLensId,
  type GraphLensSummary,
} from "@/facilis/graph-surface/lenses.ts";

const NO_DIAGNOSTICS: readonly GraphDiagnostic[] = [];

interface LensSelection {
  readonly lens: GraphLensId;
  /** The project the lens was opened on: a state lens never leaks across projects. */
  readonly projectKey: string | null;
}

export interface ProjectGraphLensState {
  readonly lens: GraphLensId | null;
  readonly summary: GraphLensSummary | null;
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
): ProjectGraphLensState {
  const lifecycle = useMemo(() => createGraphLensLifecycle(), []);
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
    lifecycle.apply(lens);
  }, [lifecycle, lens]);
  useEffect(() => () => lifecycle.dispose(), [lifecycle]);
  // A lens answer must be navigable: keep only nodes the current view actually draws.
  const facts = useMemo(() => {
    if (diagnostics === undefined || view === null) return NO_DIAGNOSTICS;
    const visible = new Set(view.nodes.map((node) => node.id));
    return diagnostics.filter((entry) => visible.has(entry.nodeId));
  }, [diagnostics, view]);
  const byNode = useMemo(() => diagnosticsByNode(facts), [facts]);
  const summary = useMemo(() => (lens === null ? null : summarizeLens(lens, facts)), [lens, facts]);
  const highlight = useMemo(() => (summary === null ? null : lensHighlight(summary)), [summary]);
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
    summary,
    highlight,
    byNode,
    availabilityOf: lifecycle.availabilityOf,
    selectLens,
    closeLens,
  };
}
