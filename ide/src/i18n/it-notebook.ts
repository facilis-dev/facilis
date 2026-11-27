// Italian form of en-notebook.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const notebookIt: Partial<Record<MessageKey, string>> = {
  "notebook.cellLabel": "Cella di codice {index} di {total}",
  "notebook.markdownCellLabel": "Cella Markdown {index} di {total}",
  "notebook.markdownCellControl": "Cella Markdown {index} di {total}. Premi Invio per modificare",
  "notebook.markdownEdit": "Modifica cella Markdown {index} di {total}",
  "notebook.markdownEditHint": "Doppio clic per modificare",
  "notebook.emptyMarkdown": "Cella Markdown vuota — doppio clic per modificare",
  "notebook.runCellHint": "Esegui cella ({chord})",
  "notebook.a11y.running": "Esecuzione di {cell} in corso.",
  "notebook.a11y.finished": "{cell} ha terminato.",
  "notebook.a11y.failed": "{cell} ha terminato con un errore.",
  "notebook.a11y.stopped": "Il kernel Python si è fermato.",
};
