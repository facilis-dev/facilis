// The Source Control diff tab's Monaco diff editor (D-088).
//
// One instance per controller. It owns the throwaway original/modified models and never
// touches the tab strip: the controller decides which diff tab is active and hands it the
// mount point, exactly like the notebook view.
//
// Two rules matter to the user:
//  - the first hunk is revealed on open. Monaco opens a diff at line 1, so on a long file
//    the change can be a screen or ten below the fold and the tab looks like a plain copy
//    of the file — which is the bug this module was extracted to fix;
//  - the two panes are always side by side (`useInlineViewWhenSpaceIsLimited: false`). The
//    inline fallback HIDES the original version, and comparing the two is the whole point.

import type * as Monaco from "monaco-editor";
import { languageFor } from "./editor-languages";
import { overflowWidgetsNode } from "./editor-session";

export interface DiffTexts {
  /** Version at HEAD ("" for a new/untracked file). */
  head(abs: string): Promise<string>;
  /** Working-tree version ("" when the file was deleted). */
  work(abs: string): Promise<string>;
}

export interface DiffOptions {
  theme: string;
  wordWrap: boolean;
}

export class DiffSession {
  private editor: Monaco.editor.IStandaloneDiffEditor | null = null;
  private models: Monaco.editor.ITextModel[] = [];

  /** Mount (or re-target) the diff editor in `el` for `abs` (an absolute VFS path). */
  async mount(
    el: HTMLElement,
    abs: string,
    monaco: typeof Monaco,
    texts: DiffTexts,
    options: DiffOptions,
  ): Promise<void> {
    this.dispose();
    const diff = monaco.editor.createDiffEditor(el, {
      readOnly: true,
      automaticLayout: true,
      theme: options.theme,
      fontSize: 13,
      minimap: { enabled: false },
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      scrollBeyondLastLine: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      // Wrapping matters MORE here than in the text editor: a side-by-side diff gives
      // each version half the width, so a long line is cut off twice over.
      wordWrap: options.wordWrap ? "on" : "off",
      // Same pane, same preview iframe next to it — see overflowWidgetsNode.
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
    this.editor = diff;
    const [head, work] = await Promise.all([texts.head(abs), texts.work(abs).catch(() => "")]);
    // A tab switch may have torn this editor down while we awaited.
    if (this.editor !== diff) return;
    const language = languageFor(abs);
    const original = monaco.editor.createModel(head, language);
    const modified = monaco.editor.createModel(work, language);
    this.models = [original, modified];
    diff.setModel({ original, modified });
    // Waits for the computation, then scrolls the first hunk into view.
    diff.revealFirstDiff();
  }

  updateWordWrap(on: boolean) {
    this.editor?.updateOptions({ wordWrap: on ? "on" : "off" });
  }

  dispose() {
    this.editor?.dispose();
    this.editor = null;
    for (const model of this.models) model.dispose();
    this.models = [];
  }
}
