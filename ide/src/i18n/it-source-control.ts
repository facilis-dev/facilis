// Italian form of en-source-control.ts. It may land incrementally; a missing key falls
// back to English (see it.ts).
import type { MessageKey } from "./index";

export const sourceControlIt: Partial<Record<MessageKey, string>> = {
  "scm.openFile": "Apri file",
  "scm.openDiff": "Apri diff",
  "diff.workingTree": "(Working Tree)",
  "diff.empty": "Nessuna modifica rispetto a HEAD per questo file.",
};
