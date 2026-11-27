// Where a notebook cell's Monaco editor is built (issue #210 moved this out of controller.ts,
// which the file-length ratchet freezes). The cell also gets its accessible name here: a bare
// Monaco instance is an unnamed text field to a screen reader, and only this layer knows the
// cell's kind and its position in the document.
import { t } from "@/i18n";
import type { NotebookHandle } from "../controller";
import type { EditorPython } from "../editor-python";
import { overflowWidgetsNode, type EditorSession } from "../editor-session";
import { monacoThemeFor, type UiTheme } from "../terminal-theme";
import { CellEditors, type CellEditorSlot } from "./cell-editors.js";

/** What a mount needs from the controller: the shared session, the language service, the theme. */
export interface CellMountHost {
  readonly editorSession: EditorSession;
  readonly editorPython: EditorPython;
  /** A getter, not a value: the theme may change between the handle's creation and this mount. */
  readonly uiTheme: () => UiTheme;
}

/**
 * A Monaco editor for one cell.
 *
 * All of the async is HERE and none of it is in the lifetime rules: Monaco is
 * imported on demand, and once it has arrived `CellEditors.mount` is a
 * synchronous step whose ordering guarantees hold whichever of two overlapping
 * mounts lands first. That split is the fix for the dead-editor bug — see
 * notebook/cell-editors.js, which is where the rules and the evidence live.
 */
export async function mountCellEditor(
  host: CellMountHost,
  handle: NotebookHandle,
  el: HTMLElement,
  id: string,
  language: "python" | "markdown",
): Promise<CellEditorSlot | null> {
  const monaco = await host.editorSession.ensureMonaco();
  // The one benign null: the cell was deleted while Monaco was loading, so
  // there is nothing to build. Everything else throws and is reported by the
  // wrapper in makeNotebook.
  const cell = handle.doc.cell(id);
  if (!cell) return null;
  const editors = (handle.editors ??= new CellEditors(monaco, handle.abs));
  if (language === "python") host.editorPython.ensure(editors.uriFor(id, language).path);
  return editors.mount(el, id, language, cell.source, {
    theme: monacoThemeFor(host.uiTheme()),
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    // A notebook renders in the same pane as the text editor, so its cells have
    // the same preview iframe beside them. `cellEditorOptions` already sets
    // `fixedOverflowWidgets` for its own reasons; supplying the host here is
    // what carries the widget out of the pane. Passed in rather than imported
    // by cell-editors.js, which takes Monaco as a parameter precisely so it
    // stays drivable without a DOM.
    overflowWidgetsDomNode: overflowWidgetsNode(),
    // The cell's accessible name: its kind and its position in the notebook (not the
    // execution count). Without it the editor is an unnamed text field to a screen reader.
    ariaLabel: cellAriaLabel(cell.type, handle.doc.indexOf(id), handle.doc.cells.length),
  });
}

/** "Code cell 3 of 12" / "Markdown cell 2 of 12", in the IDE's own language. */
export function cellAriaLabel(type: string, index: number, total: number): string {
  return t(type === "markdown" ? "notebook.markdownCellLabel" : "notebook.cellLabel", {
    index: index + 1,
    total,
  });
}
