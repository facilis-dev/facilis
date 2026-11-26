// A Q-code is a review question, not a word: hovering it explains which question the badge
// answers, and the accessible name carries the same sentence for screen readers (issue #190).
// The prose lives in the i18n catalogue, keyed by the code in questions.ts.

import type { ReactNode } from "react";
import { t } from "@/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GRAPH_QUESTION_KEYS, type GraphQuestionCode } from "@/facilis/graph-surface/questions.ts";

export function ProjectGraphQuestionHint({
  code,
  children,
}: {
  code: GraphQuestionCode;
  children: ReactNode;
}) {
  const question = t(GRAPH_QUESTION_KEYS[code]);
  return (
    <Tooltip>
      <TooltipTrigger
        // A span keeps the trigger inline inside a <summary>; a button would fight the toggle.
        render={
          <span className="cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-2" />
        }
        aria-label={question}
        title={question}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{question}</TooltipContent>
    </Tooltip>
  );
}
