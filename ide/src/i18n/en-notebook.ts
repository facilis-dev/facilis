// Notebook strings (issue #210, #221). A cell's Monaco instance is an unnamed text
// field to a screen reader, so each cell editor carries its position and its kind; the
// rendered markdown cell and the run announcements are here for the same reason. A
// per-feature catalogue because en.ts is at its line cap.
export const notebookEn = {
  "notebook.cellLabel": "Code cell {index} of {total}",
  "notebook.markdownCellLabel": "Markdown cell {index} of {total}",
  "notebook.markdownCellControl": "Markdown cell {index} of {total}. Enter to edit",
  "notebook.markdownEdit": "Edit markdown cell {index} of {total}",
  "notebook.markdownEditHint": "Double-click to edit",
  "notebook.emptyMarkdown": "Empty markdown cell — double-click to edit",
  "notebook.a11y.running": "Running {cell}.",
  "notebook.a11y.finished": "{cell} finished.",
  "notebook.a11y.failed": "{cell} finished with an error.",
  "notebook.a11y.stopped": "The Python kernel stopped.",
} as const;
