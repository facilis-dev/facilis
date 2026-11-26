// The review questions the graph answers (epic #182, issue #190) as first-class codes.
// A "Q7" badge means nothing to a human, so every Q-code the surface shows resolves here to a
// full question key: the tooltip explains it on hover and the accessible name reads it aloud.
// Codes and keys only — the prose lives in the i18n catalogues (D-043).

import type { MessageKey } from "@/i18n";
import type { GraphAnswerId } from "./answers-types.ts";
import type { GraphLensId } from "./lenses.ts";

export type GraphQuestionCode = "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6" | "Q7" | "Q8" | "Q9" | "Q10" | "Q16" | "Q17";

export const GRAPH_QUESTION_KEYS: Readonly<Record<GraphQuestionCode, MessageKey>> = {
  Q1: "projectGraph.surface.question.q1",
  Q2: "projectGraph.surface.question.q2",
  Q3: "projectGraph.surface.question.q3",
  Q4: "projectGraph.surface.question.q4",
  Q5: "projectGraph.surface.question.q5",
  Q6: "projectGraph.surface.question.q6",
  Q7: "projectGraph.surface.question.q7",
  Q8: "projectGraph.surface.question.q8",
  Q9: "projectGraph.surface.question.q9",
  Q10: "projectGraph.surface.question.q10",
  Q16: "projectGraph.surface.question.q16",
  Q17: "projectGraph.surface.question.q17",
};

/** Inspector section id ("q3") -> the question it answers ("Q3"). */
export const ANSWER_QUESTION_CODES: Readonly<Record<GraphAnswerId, GraphQuestionCode>> = {
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
  q5: "Q5",
  q6: "Q6",
  q7: "Q7",
  q8: "Q8",
  q9: "Q9",
  q10: "Q10",
  q16: "Q16",
  q17: "Q17",
};

/** The lens switcher is a Q&A surface: each lens is one of the review questions. */
export const LENS_QUESTION_CODES: Readonly<Record<GraphLensId, GraphQuestionCode>> = {
  security: "Q5",
  elevated: "Q4",
  shared: "Q9",
  unknown: "Q17",
};

export function answerQuestionKey(id: GraphAnswerId): MessageKey {
  return GRAPH_QUESTION_KEYS[ANSWER_QUESTION_CODES[id]];
}

export function lensQuestionKey(id: GraphLensId): MessageKey {
  return GRAPH_QUESTION_KEYS[LENS_QUESTION_CODES[id]];
}
