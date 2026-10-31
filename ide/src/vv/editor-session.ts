// The Monaco editor session: worker setup, the editor instance, the status-bar
// readouts and the editor actions. Split out of controller.ts (D-019/D-042);
// the controller keeps the model cache and the tab strip, and exposes the live
// instances through getters so the remaining call sites are unchanged.

import type * as Monaco from "monaco-editor";
import type { DebugSession } from "./debug-session";
import type { EditorLanguage } from "./editor-language";
import type { EditorStatus } from "./editor-status";
import { monacoThemeFor, type UiTheme } from "./terminal-theme";

/**
 * The one node every Monaco editor here reparents its overflowing widgets into
 * — hover, suggest, signature help, the context menu.
 *
 * Monaco already lifts those out of the editor's scrolling box into an
 * `.overflowingContentWidgets` div, which is why a hover can extend past the
 * gutter. What it cannot do on its own is lift them out of the PAGE: that div
 * stays inside the editor's DOM, and the editor pane is an EARLIER sibling of
 * the preview pane, whose iframe is positioned and so paints over anything
 * reaching in from an earlier sibling. A hover on a long line was cut off at
 * that seam.
 *
 * Reparenting is the part that fixes it (view.js moves both overflow containers
 * into the supplied node), because this node is a later sibling of the whole app.
 * `fixedOverflowWidgets` alone does NOT — measured against 0.55.1 in a browser,
 * not assumed: it changes where a widget is laid out, not what paints over it,
 * and the rendering was pixel-identical to the bug. It is still set, because it
 * is the mode an external host implies: Monaco then lays widgets out in page
 * coordinates clamped to the window rather than against the editor. With this
 * node pinned at the viewport origin the two placements coincide for a hover
 * that is already on screen (also measured), so the flag is about behaviour at
 * the window edges, not about the fix.
 *
 * Two properties of this node are load-bearing:
 * - `monaco-editor` is not decoration. The standalone theme service emits every
 *   `--vscode-*` colour as a rule on `.monaco-editor, .monaco-diff-editor,
 *   .monaco-component`, so a widget that lives outside one of those renders with
 *   no background at all, over whatever it happens to cover. Verified by reading
 *   `--vscode-editorHoverWidget-background` back off this node.
 * - No z-index, deliberately. At `auto` it already beats the panes, which are
 *   also `auto`, while still losing to the app's real overlays (HomeView's z-40,
 *   the share overlay's z-50) — a modal should cover a tooltip, not the reverse.
 */
let overflowWidgetsHost: HTMLElement | null = null;
export function overflowWidgetsNode(): HTMLElement {
  if (overflowWidgetsHost?.isConnected) return overflowWidgetsHost;
  const node = document.createElement("div");
  node.className = "vv-overflow-widgets monaco-editor";
  document.body.appendChild(node);
  overflowWidgetsHost = node;
  return node;
}

/** What the editor session needs from the controller. */
export interface EditorSessionHost {
  language: EditorLanguage;
  debug: DebugSession;
  editorStatus: EditorStatus;
  /** The root-file lists that seed background models before a tab opens. */
  fileIndexLists(): string[][];
  activeTab(): string | null;
  openFile(abs: string): void;
  wordWrap(): boolean;
  appearance(): UiTheme;
  /** A hand-picked language mode for a tab (undefined = auto-detect). */
  languageOverride(abs: string): string | undefined;
  setLanguageOverride(abs: string, language: string | null): void;
  languageOf(abs: string): string;
}

export class EditorSession {
  private readonly host: EditorSessionHost;
  private monacoNs: typeof Monaco | null = null;
  private codeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  private mounting = false; // guards the async create against StrictMode double-mount
  private modelStatusSub: Monaco.IDisposable | null = null;

  constructor(host: EditorSessionHost) {
    this.host = host;
  }

  monaco(): typeof Monaco | null {
    return this.monacoNs;
  }

  editor(): Monaco.editor.IStandaloneCodeEditor | null {
    return this.codeEditor;
  }

  /** Load Monaco on demand (the diff editor can mount before the main editor). */
  async ensureMonaco(): Promise<typeof Monaco> {
    return (this.monacoNs ??= await import("monaco-editor"));
  }

  applyTheme(theme: UiTheme) {
    this.monacoNs?.editor.setTheme(monacoThemeFor(theme));
  }

  async mount(el: HTMLElement) {
    if (this.codeEditor || this.mounting) return;
    this.mounting = true;
    // Real language intelligence: wire Monaco's own web workers. Vite bundles each
    // `?worker` entry into a same-origin chunk (COEP-safe), and we run them
    // off-main-thread so completions, hover, signature help, go-to-definition and
    // diagnostics never block the UI. The editor worker backs cross-file services;
    // the typescript worker hosts a full TS language service (bundled TS compiler).
    const [editorWorker, tsWorker, jsonWorker, cssWorker, htmlWorker] = await Promise.all([
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
    ]);
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker(_workerId: string, label: string): Worker {
        switch (label) {
          case "typescript":
          case "javascript":
            return new tsWorker.default();
          case "json":
            return new jsonWorker.default();
          case "css":
          case "scss":
          case "less":
            return new cssWorker.default();
          case "html":
          case "handlebars":
          case "razor":
            return new htmlWorker.default();
          default:
            return new editorWorker.default();
        }
      },
    };
    const monaco = await this.ensureMonaco();
    this.host.language.configure(monaco);
    this.host.language.wireGoToDefinition(monaco);
    this.codeEditor = monaco.editor.create(el, {
      model: null,
      theme: monacoThemeFor(this.host.appearance()),
      automaticLayout: true,
      fontSize: 13,
      // Minimap renders (and retains) a second tokenized view of the whole file;
      // disabling it trims per-editor memory at no real usability cost here.
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      // Go-to-definition should NAVIGATE, not peek. The Peek widget's preview pane
      // can only render an existing Monaco model, but dependency types live only as
      // extra libs (see loadDependencyTypes) — never as models — so peeking a
      // node_modules definition shows an empty preview. Jumping straight to the
      // first location routes through our editor opener, which reads the target
      // from the VFS and opens it as a real tab (so .d.ts targets render fine).
      gotoLocation: {
        multipleDefinitions: "goto",
        multipleTypeDefinitions: "goto",
        multipleDeclarations: "goto",
        multipleImplementations: "goto",
      },
      // We handle drops onto the editor ourselves (open the dropped entry), so
      // turn off Monaco's built-in "drop text into the buffer" behavior.
      dropIntoEditor: { enabled: false },
      // Breakpoint debugger: the glyph margin hosts breakpoint dots + the paused
      // arrow, and a click there toggles a breakpoint (see DebugSession).
      glyphMargin: true,
      // Don't over-reserve the line-number column (Monaco defaults to 5 chars,
      // which right-aligns single digits and leaves a big gap to their left).
      lineNumbersMinChars: 2,
      // Seeded from the persisted preference rather than set afterwards, so a wrapped
      // session does not flash one unwrapped frame on every cold boot.
      wordWrap: this.host.wordWrap() ? "on" : "off",
      // Hovers and suggest lists have to survive leaving the editor pane — the
      // preview iframe next door paints over anything that does not. See
      // overflowWidgetsNode.
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
    // Breakpoint debugger: wire gutter breakpoints + paused-line decorations.
    this.host.debug.attachEditor(this.codeEditor, monaco);
    this.codeEditor.onDidChangeModelContent(() => this.host.language.enableIntelligence());
    this.wireStatus(this.codeEditor);
    // Seed the language service with any folders indexed before the editor was
    // ready (source files as models for cross-file IntelliSense; dependency types
    // as extra libs), then open whatever tab was requested during load.
    for (const list of this.host.fileIndexLists()) this.host.language.ensureBackgroundModels(list);
    this.host.language.scheduleDependencyTypes();
    const tab = this.host.activeTab();
    if (tab) void this.host.openFile(tab);
  }

  // ── status-bar readouts (Ln/Col · indentation · language mode) ──────────────
  // Mirror Monaco's cursor, indentation and language onto the EditorStatus store
  // that the StatusBar subscribes to. Model-scoped listeners are re-bound on every
  // model swap so we only ever watch the attached model.
  private wireStatus(editor: Monaco.editor.IStandaloneCodeEditor) {
    const pushCursor = () => {
      const model = editor.getModel();
      const pos = editor.getPosition();
      if (!model || !pos) return;
      const selections = editor.getSelections() ?? [];
      let selected = 0;
      for (const s of selections) selected += model.getValueLengthInRange(s);
      this.host.editorStatus.set({
        cursor: {
          line: pos.lineNumber,
          column: pos.column,
          selected,
          selections: selections.length,
        },
        lineCount: model.getLineCount(),
      });
    };
    const pushModelInfo = () => {
      const model = editor.getModel();
      if (!model) {
        this.host.editorStatus.clear();
        return;
      }
      const { insertSpaces, tabSize } = model.getOptions();
      this.host.editorStatus.set({
        indent: { insertSpaces, tabSize },
        language: model.getLanguageId(),
        lineCount: model.getLineCount(),
      });
    };
    const rebindModel = () => {
      this.modelStatusSub?.dispose();
      this.modelStatusSub = null;
      const model = editor.getModel();
      pushModelInfo();
      if (!model) return;
      const subs = [
        model.onDidChangeOptions(pushModelInfo),
        model.onDidChangeLanguage(pushModelInfo),
        // Line count feeds the Go to Line hint, so it has to track edits.
        model.onDidChangeContent(pushCursor),
      ];
      this.modelStatusSub = { dispose: () => subs.forEach((s) => s.dispose()) };
      pushCursor();
    };
    editor.onDidChangeModel(rebindModel);
    editor.onDidChangeCursorPosition(pushCursor);
    editor.onDidChangeCursorSelection(pushCursor);
    rebindModel();
  }

  /** Jump the cursor to a 1-based line/column in the ACTIVE editor (status-bar
   * "Ln x, Col y" → Go to Line). Clamped to the model's bounds. */
  gotoLine(line: number, column = 1) {
    const model = this.codeEditor?.getModel();
    if (!model) return;
    const l = Math.min(Math.max(1, Math.trunc(line)), model.getLineCount());
    const c = Math.min(Math.max(1, Math.trunc(column)), model.getLineMaxColumn(l));
    this.reveal(l, c, 0);
  }

  /** Set the active tab's language mode. `null` restores auto-detection from the
   * file extension and forgets the override. */
  setLanguageMode(id: string | null) {
    const abs = this.host.activeTab();
    const model = this.codeEditor?.getModel();
    if (!abs || !model || !this.monacoNs) return;
    this.host.setLanguageOverride(abs, id);
    this.monacoNs.editor.setModelLanguage(model, id ?? this.host.languageOf(abs));
    this.codeEditor?.focus();
  }

  /** Change the active model's indentation (status-bar "Spaces: n" picker). */
  setIndentation(opts: { insertSpaces?: boolean; tabSize?: number }) {
    this.codeEditor?.getModel()?.updateOptions(opts);
    this.codeEditor?.focus();
  }

  /** Guess indentation from the file's own content, like VS Code's
   * "Detect Indentation from Content". Falls back to the editor defaults. */
  detectIndentation() {
    const model = this.codeEditor?.getModel();
    if (!model) return;
    const current = model.getOptions();
    model.detectIndentation(current.insertSpaces, current.tabSize);
    this.codeEditor?.focus();
  }

  /** Run a built-in Monaco editor action by id (indentation conversion + trim
   * trailing whitespace in the status-bar picker). */
  runEditorAction(id: string) {
    void this.codeEditor?.getAction(id)?.run();
    this.codeEditor?.focus();
  }

  reveal(line: number, column: number, length: number) {
    if (!this.codeEditor || !this.monacoNs) return;
    const range = new this.monacoNs.Range(line, column, line, column + (length || 0));
    this.codeEditor.setSelection(range);
    this.codeEditor.revealRangeInCenterIfOutsideViewport(range);
    this.codeEditor.focus();
  }
}
