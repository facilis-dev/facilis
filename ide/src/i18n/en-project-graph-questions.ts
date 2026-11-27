// The graph's review questions (epic #182, issue #190): a Q-code alone tells a human
// nothing, so every badge resolves to the full question here. Split from the main feature
// catalogue, which is at the 300-line source limit. Keys stay flat.
export const projectGraphQuestionsEn = {
  // ── the questions behind the Q-codes (issue #190) ───────────────────────────
  "projectGraph.surface.question.hint": "Hover a Q-code to read the question it answers.",
  "projectGraph.surface.question.q1": "Q1 — Which routes does this page call?",
  "projectGraph.surface.question.q2": "Q2 — Which pages call this route?",
  "projectGraph.surface.question.q3":
    "Q3 — Which tables and views does this page reach through its routes (two hops)?",
  "projectGraph.surface.question.q4":
    "Q4 — Which routes touch data through audited sudo/system elevation?",
  "projectGraph.surface.question.q5":
    "Q5 — Which RLS class, grants and policies does this table have?",
  "projectGraph.surface.question.q6":
    "Q6 — Which wrapper and permission guard this route, and which input schemas does it accept?",
  "projectGraph.surface.question.q7":
    "Q7 — Where is this table used: readers, writers, foreign keys and views?",
  "projectGraph.surface.question.q8":
    "Q8 — Which external references and views touch this node's domain?",
  "projectGraph.surface.question.q9":
    "Q9 — Which nodes are referenced by more than one other domain?",
  "projectGraph.surface.question.q10":
    "Q10 — What breaks across the project if this node is dropped?",
  "projectGraph.surface.question.q16": "Q16 — Where is this node's source file?",
  "projectGraph.surface.question.q17": "Q17 — Which facts could the analyzer not read statically?",
  "projectGraph.surface.question.q18":
    "Q18 — What is this route doing right now: traffic, 5xx errors and p50/p95 latency?",
  "projectGraph.surface.question.q19":
    "Q19 — What changed since the agent's checkpoint, and which nodes own those files?",
  "projectGraph.surface.question.q20":
    "Q20 — What can a role reach: which routes, pages and tables does its permission set unlock?",
  "projectGraph.surface.question.q21":
    "Q21 — Which pages prerender at build time, which are eligible but undeclared, and what blocks the rest?",
};
