// The meaning-lens composition (issues #72, #69, #70, #73): the runtime lens's seam lifecycle,
// the contract lens's audit wiring, the data lens's schema facts and the agent lens's turn-diff
// overlay, bound to the same view state. Extracted from ProjectGraphPanel so the composition
// root stays under the 300-line source limit as lenses land; each lens keeps its own hook, this
// one only composes their results.

import type { Analysis } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { IdeController } from "@/vv/controller";
import { useProjectGraphAudit, type ProjectGraphAudit } from "./useProjectGraphAudit";
import { useProjectGraphDataLens, type ProjectGraphDataLens } from "./useProjectGraphDataLens";
import { useGraphTurnDiff, type GraphTurnDiffState } from "./useGraphTurnDiff";
import {
  useProjectGraphRuntimeLens,
  type ProjectGraphRuntimeLens,
} from "./useProjectGraphRuntimeLens";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphLenses {
  readonly runtime: ProjectGraphRuntimeLens;
  readonly audit: ProjectGraphAudit;
  readonly data: ProjectGraphDataLens;
  /** The agent lens (issue #73): SCM-derived, read-only, off while the tree is clean. */
  readonly turn: GraphTurnDiffState;
}

export function useProjectGraphLenses(
  controller: IdeController,
  analysis: Analysis | null,
  view: ProjectGraphView | null,
  viewState: ProjectGraphViewState,
): ProjectGraphLenses {
  // Both lenses gate their marks on the same viewport zoom; read it once from the layout.
  const zoom = viewState.graph.layout.viewport?.zoom ?? 1;
  const runtime = useProjectGraphRuntimeLens(controller, view, viewState, zoom);
  const audit = useProjectGraphAudit(analysis, view, viewState, zoom);
  const data = useProjectGraphDataLens(view, viewState.state, zoom);
  // The turn diff reads the SCM store and the drawn view; HEAD is the only turn base (D-181).
  const turn = useGraphTurnDiff(
    controller,
    controller.activeFolder?.rootPath ?? null,
    view,
    viewState.state.activeLenses,
  );
  return { runtime, audit, data, turn };
}
