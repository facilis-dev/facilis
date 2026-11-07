// Source Control + diff-tab strings (D-088), spread into `en` in en.ts.
//
// The SCM panel is upstream-inherited and still carries its original labels (see the
// retrofit table in ide/I18N.md); these keys cover what this fork adds to it — the diff
// tab label, the row actions — so the new controls ship translated from their first
// commit (D-043).
export const sourceControlEn = {
  "scm.openFile": "Open file",
  "scm.openDiff": "Open diff",
  "diff.workingTree": "(Working Tree)",
  "diff.empty": "No changes against HEAD for this file.",
} as const;
