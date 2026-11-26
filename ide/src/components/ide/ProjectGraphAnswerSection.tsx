// One collapsible answer section (issue #190): the question title, its row count, an explicit
// empty state and a capped list with a way to see every row. Rows are grouped by domain where
// the question asks for it (Q8/Q9/Q10).
import { useState } from "react";
import { t } from "@/i18n";
import type { GraphAnswerSection } from "@/facilis/graph-surface/answers-types";
import { Chip, EmptyNote, SECTION_TITLE } from "./ProjectGraphDetailsSection";
import { ProjectGraphAnswerRow } from "./ProjectGraphAnswerRow";
import { ProjectGraphQuestionHint } from "./ProjectGraphQuestionHint";
import { ANSWER_QUESTION_CODES } from "@/facilis/graph-surface/questions.ts";

/** How many rows show before the "+N more" control: the drawer stays readable. */
const VISIBLE_LIMIT = 5;

export interface ProjectGraphAnswerSectionProps {
  section: GraphAnswerSection;
  onNavigateNode: (nodeId: string) => void;
  onOpenFileAt: (file: string, line: number) => void;
}

export function ProjectGraphAnswerSection({
  section,
  onNavigateNode,
  onOpenFileAt,
}: ProjectGraphAnswerSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = Math.max(0, section.rows.length - VISIBLE_LIMIT);
  const visibleRows = showAll ? section.rows : section.rows.slice(0, VISIBLE_LIMIT);
  let previousGroup: string | null = null;
  return (
    <details
      open
      data-testid={"project-graph-answer-" + section.id}
      className="rounded border bg-card/40"
    >
      <summary className="flex cursor-pointer items-center gap-1 px-1.5 py-1">
        <span className={SECTION_TITLE + " min-w-0 flex-1 truncate"}>
          <ProjectGraphQuestionHint code={ANSWER_QUESTION_CODES[section.id]}>
            {t(section.titleKey)}
          </ProjectGraphQuestionHint>
        </span>
        <Chip>{section.rows.length}</Chip>
      </summary>
      <div className="space-y-1 px-1.5 pb-1.5">
        {section.summary !== null && (
          <p className="text-[10px] text-muted-foreground">
            {t(section.summary.key, section.summary.params ?? undefined)}
          </p>
        )}
        {section.rows.length === 0 ? (
          <EmptyNote message={t(section.emptyKey)} />
        ) : (
          <ul className="space-y-0.5">
            {visibleRows.map((row) => {
              const showGroup =
                section.groupByDomain && row.group !== null && row.group !== previousGroup;
              previousGroup = row.group;
              return (
                <li key={row.key} className="space-y-0.5">
                  {showGroup && (
                    <p className="px-0.5 pt-0.5 text-[9px] font-semibold text-muted-foreground">
                      {row.group}
                    </p>
                  )}
                  <ProjectGraphAnswerRow
                    row={row}
                    onNavigateNode={onNavigateNode}
                    onOpenFileAt={onOpenFileAt}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="w-full rounded border px-1.5 py-0.5 text-left text-[9px] text-muted-foreground hover:border-ring"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll
              ? t("projectGraph.surface.answers.showLess")
              : t("projectGraph.surface.answers.more", { count: hiddenCount })}
          </button>
        )}
      </div>
    </details>
  );
}
