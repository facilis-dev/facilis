// The project graph's lens state (D-220, #189), split from the panel to keep both under the
// 300-line source limit. Lenses are draw state only: this hook never touches the layout, the
// saved positions or the camera, and every derived value is memoized on the analyzer facts.

import { useCallback, useMemo, useState } from "react";
import type { GraphDiagnostic } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  diagnosticsByNode,
  lensHighlight,
  summarizeLens,
  type GraphLensHighlight,
  type GraphLensId,
  type GraphLensSummary,
} from "@/facilis/graph-surface/lenses.ts";

const NO_DIAGNOSTICS: readonly GraphDiagnostic[] = [];

export interface ProjectGraphLensState {
  readonly lens: GraphLensId | null;
  readonly summary: GraphLensSummary | null;
  readonly highlight: GraphLensHighlight | null;
  readonly byNode: ReadonlyMap<string, readonly GraphDiagnostic[]>;
  readonly selectLens: (lens: GraphLensId) => void;
  readonly closeLens: () => void;
}

export function useProjectGraphLens(
  diagnostics: readonly GraphDiagnostic[] | undefined,
  view: ProjectGraphView | null,
): ProjectGraphLensState {
  const [lens, setLens] = useState<GraphLensId | null>(null);
  // A lens answer must be navigable: keep only nodes the current view actually draws.
  const facts = useMemo(() => {
    if (diagnostics === undefined || view === null) return NO_DIAGNOSTICS;
    const visible = new Set(view.nodes.map((node) => node.id));
    return diagnostics.filter((entry) => visible.has(entry.nodeId));
  }, [diagnostics, view]);
  const byNode = useMemo(() => diagnosticsByNode(facts), [facts]);
  const summary = useMemo(() => (lens === null ? null : summarizeLens(lens, facts)), [lens, facts]);
  const highlight = useMemo(() => (summary === null ? null : lensHighlight(summary)), [summary]);
  const selectLens = useCallback((next: GraphLensId) => {
    setLens((current) => (current === next ? null : next));
  }, []);
  const closeLens = useCallback(() => setLens(null), []);
  return { lens, summary, highlight, byNode, selectLens, closeLens };
}
