// The inspector's answer stack (issue #190): one collapsible section per project-graph
// question, derived from the memoized graph view, the analyzer details join and the graph
// diagnostics. It never rebuilds layout or camera state; navigation goes through the panel's
// jump handler so a row click selects, drills and centres exactly like a search jump.
import { useMemo } from "react";
import { t } from "@/i18n";
import type { GraphDiagnostic } from "@facilis.dev/analyze";
import type { NodeDetails } from "@/facilis/graph-details";
import type { ProjectGraphNode, ProjectGraphView } from "@/facilis/graph-model";
import { buildNodeAnswerSections } from "@/facilis/graph-surface/answers";
import { createAnswerContext } from "@/facilis/graph-surface/answers-context";
import { SECTION_TITLE } from "./ProjectGraphDetailsSection";
import { ProjectGraphAnswerSection } from "./ProjectGraphAnswerSection";

export interface ProjectGraphAnswersProps {
  node: ProjectGraphNode;
  view: ProjectGraphView;
  details: ReadonlyMap<string, NodeDetails>;
  diagnostics: readonly GraphDiagnostic[];
  onNavigateNode: (nodeId: string) => void;
  onOpenFileAt: (file: string, line: number) => void;
}

export function ProjectGraphAnswers({
  node,
  view,
  details,
  diagnostics,
  onNavigateNode,
  onOpenFileAt,
}: ProjectGraphAnswersProps) {
  const context = useMemo(
    () => createAnswerContext(view, details, diagnostics),
    [view, details, diagnostics],
  );
  const sections = useMemo(() => buildNodeAnswerSections(node, context), [node, context]);
  return (
    <div data-testid="project-graph-answers" className="space-y-1">
      <h3 className={SECTION_TITLE}>{t("projectGraph.surface.answers.title")}</h3>
      {sections.map((section) => (
        <ProjectGraphAnswerSection
          key={section.id}
          section={section}
          onNavigateNode={onNavigateNode}
          onOpenFileAt={onOpenFileAt}
        />
      ))}
    </div>
  );
}
