// Italian form of en-notebook.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const notebookIt: Partial<Record<MessageKey, string>> = {
  "notebook.cellLabel": "Cella di codice {index} di {total}",
  "notebook.markdownCellLabel": "Cella Markdown {index} di {total}",
};
