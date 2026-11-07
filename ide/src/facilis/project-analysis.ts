import type { Analysis } from "@facilis/analyze";
import type { IdeController } from "@/vv/controller";

/** Result of one browser-side analysis of the active project. */
export type ProjectAnalysisResult =
  | { readonly ok: true; readonly analysis: Analysis }
  | { readonly ok: false; readonly error: string };

/** Loader contract consumed by the project-graph panel. */
export type ProjectAnalysisLoader = (controller: IdeController) => Promise<ProjectAnalysisResult>;

export const PROJECT_ANALYSIS_LOADER = "loadProjectAnalysis" as const;
