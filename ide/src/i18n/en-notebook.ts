// Notebook strings (issue #210). A cell's Monaco instance is an unnamed text field to a
// screen reader, so each cell editor carries its position and its kind. A per-feature
// catalogue because en.ts is at its line cap.
export const notebookEn = {
  "notebook.cellLabel": "Code cell {index} of {total}",
  "notebook.markdownCellLabel": "Markdown cell {index} of {total}",
} as const;
