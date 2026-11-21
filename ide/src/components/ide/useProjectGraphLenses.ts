// The meaning-lens composition (issues #72, #69, #70): the runtime lens's seam lifecycle, the
// contract lens's audit wiring and the data lens's schema facts, bound to the same view state
// and viewport zoom. Extracted from ProjectGraphPanel so the composition root stays under the
// 300-line source limit as lenses land; each lens keeps its own hook, this one only composes
// their results.

import type { Analysis } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { IdeController } from "@/vv/controller";
import { useProjectGraphAudit, type ProjectGraphAudit } from "./useProjectGraphAudit";
import { useProjectGraphDataLens, type ProjectGraphDataLens } from "./useProjectGraphDataLens";
import {
  useProjectGraphRuntimeLens,
  type ProjectGraphRuntimeLens,
} from "./useProjectGraphRuntimeLens";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphLenses {
  readonly runtime: ProjectGraphRuntimeLens;
  readonly audit: ProjectGraphAudit;
  readonly data: ProjectGraphDataLens;
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
  return { runtime, audit, data };
}
