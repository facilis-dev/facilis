// The project-graph view the panel renders, loaded outside React (D-171).
//
// The panel builds its view inside a useMemo from the analysis plus the saved layout; the AI
// graph tools must validate ids against exactly that view, so the construction is extracted
// here and both callers share it. Pure in the sense that matters for the tools: no React, no
// DOM, no controller UI state beyond the folder's root path.

import type { IdeController } from "@/vv/controller";
import { loadProjectAnalysis } from "./analyze-client";
import { loadGraphLayout, type GraphLayoutFile } from "./graph-layout";
import { buildProjectGraphView } from "./graph-model";
import type { ProjectGraphView } from "./graph-types";

export type GraphViewLoad =
  | {
      readonly ok: true;
      readonly view: ProjectGraphView;
      readonly layout: GraphLayoutFile;
    }
  | { readonly ok: false; readonly reason: "no_project" | "analysis_failed" };

/**
 * Load the visible view: saved positions, hidden edge kinds, collapsed cards and the system
 * filters are all applied, so a tool never names something the canvas does not draw.
 */
export async function loadGraphView(controller: IdeController): Promise<GraphViewLoad> {
  const root = controller.activeFolder?.rootPath ?? null;
  if (root === null) return { ok: false, reason: "no_project" };
  const [loaded, analysis] = await Promise.all([
    loadGraphLayout(controller, root),
    loadProjectAnalysis(controller),
  ]);
  if (!analysis.ok) return { ok: false, reason: "analysis_failed" };
  const view = buildProjectGraphView({
    graph: analysis.analysis.graph,
    positions: loaded.layout.nodes,
    hiddenEdgeKinds: loaded.layout.hiddenEdges,
    hideSystemRoutes: loaded.layout.hideSystemRoutes,
    hideSystemTables: loaded.layout.hideSystemTables,
    collapsed: loaded.layout.collapsed,
  });
  return { ok: true, view, layout: loaded.layout };
}
