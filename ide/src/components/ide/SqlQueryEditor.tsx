// The Data Explorer console's SQL editor (D-097): a small Monaco instance with
// context-aware completion. Monaco is imported lazily because the console is not
// part of the first paint, and the completion provider is scoped to this editor's
// model so the main code editor never receives SQL suggestions.

import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useTheme } from "next-themes";
import { t } from "@/i18n";
import { appearanceOf } from "@/ui-themes";
import { monacoThemeFor } from "@/vv/terminal-theme";
import { sqlCompletions, type SqlCompletionKind, type SqlTable } from "@/facilis/sql-completion";
import { cn } from "@/lib/utils";

export interface SqlQueryEditorProps {
  value: string;
  onChange: (sql: string) => void;
  onRun: () => void;
  schemaTables: readonly SqlTable[];
  className?: string;
}

/** Monaco's completion kind for a candidate kind from the pure engine. */
function completionKind(
  monaco: typeof Monaco,
  kind: SqlCompletionKind,
): Monaco.languages.CompletionItemKind {
  switch (kind) {
    case "keyword":
      return monaco.languages.CompletionItemKind.Keyword;
    case "table":
      return monaco.languages.CompletionItemKind.Struct;
    case "column":
      return monaco.languages.CompletionItemKind.Field;
  }
}

interface MonacoEnvironmentScope {
  MonacoEnvironment?: unknown;
}

/**
 * Install the minimal editor worker only when the main editor has not set one:
 * overwriting `self.MonacoEnvironment` here would silently drop the language workers
 * (typescript/json/css/html) that the rest of the IDE relies on.
 */
function ensureEditorWorker(): void {
  const scope = self as unknown as MonacoEnvironmentScope;
  if (scope.MonacoEnvironment !== undefined) return;
  scope.MonacoEnvironment = { getWorker: () => new EditorWorker() };
}

export function SqlQueryEditor({
  value,
  onChange,
  onRun,
  schemaTables,
  className,
}: SqlQueryEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorLabel = t("dataQuery.editorLabel");
  const { theme, resolvedTheme, systemTheme } = useTheme();
  const appearance = appearanceOf(theme, resolvedTheme, systemTheme);
  // Callbacks, schema and label travel through one ref, updated in an effect (the
  // repo's pattern) so the Monaco instance never depends on their identity.
  const latest = useRef({ value, onChange, onRun, schemaTables, appearance, editorLabel });
  useEffect(() => {
    latest.current = { value, onChange, onRun, schemaTables, appearance, editorLabel };
  });

  // Create the editor once; the cleanup cancels the async create so a StrictMode
  // double mount cannot leak an instance, a model or a completion provider.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let model: Monaco.editor.ITextModel | null = null;
    let completion: Monaco.IDisposable | null = null;

    void (async () => {
      // Awaited: when the main editor has not set MonacoEnvironment yet, the minimal
      // worker must exist before the first editor asks for it.
      await ensureEditorWorker();
      const monaco = await import("monaco-editor");
      if (cancelled) return;
      monacoRef.current = monaco;
      model = monaco.editor.createModel(latest.current.value, "sql");
      const createdModel = model;
      const created = monaco.editor.create(host, {
        model: createdModel,
        theme: monacoThemeFor(latest.current.appearance),
        // The real input is Monaco's own textarea, so the label goes there; the host
        // div's aria-label only keeps a stable, labelled selector.
        ariaLabel: latest.current.editorLabel,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        scrollBeyondLastLine: false,
        wordWrap: "off",
        lineNumbersMinChars: 2,
        padding: { top: 4, bottom: 4 },
        // The host clips (overflow-hidden makes resize-y possible), and the suggest
        // list is absolutely positioned: fixed placement keeps it from being cut off.
        fixedOverflowWidgets: true,
      });
      editor = created;
      editorRef.current = created;
      createdModel.onDidChangeContent(() => {
        latest.current.onChange(createdModel.getValue());
      });
      // Ctrl on Windows/Linux, Cmd on macOS; the editor owns the keybinding, so
      // disposing the editor removes it too.
      created.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
        latest.current.onRun();
      });
      completion = monaco.languages.registerCompletionItemProvider("sql", {
        // A dot opens the list for qualified columns; quickSuggestions handles normal
        // typing, and Ctrl/Cmd+Space invokes it explicitly, so a space trigger (which
        // would pop the list after every keyword) is deliberately not registered.
        triggerCharacters: ["."],
        provideCompletionItems(otherModel, position) {
          // The provider is registered per language, not per instance: any other
          // SQL model must keep getting the built-in (empty) list.
          if (otherModel !== createdModel) return { suggestions: [] };
          const word = createdModel.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            position.column,
          );
          const suggestions = sqlCompletions({
            text: createdModel.getValue(),
            offset: createdModel.getOffsetAt(position),
            tables: latest.current.schemaTables,
          }).map((item): Monaco.languages.CompletionItem => {
            const suggestion: Monaco.languages.CompletionItem = {
              label: item.label,
              kind: completionKind(monaco, item.kind),
              insertText: item.insertText,
              sortText: item.sortText,
              range,
            };
            if (item.detail !== undefined) suggestion.detail = item.detail;
            return suggestion;
          });
          return { suggestions };
        },
      });
    })();

    return () => {
      cancelled = true;
      completion?.dispose();
      editor?.dispose();
      model?.dispose();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  // The panel owns the text, so a value that changed outside the editor wins.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model !== null && model !== undefined && model.getValue() !== value) model.setValue(value);
  }, [value]);

  // Follow the app theme live; the id is shared with the main editor, so this
  // re-applies the same one for that instance.
  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoThemeFor(appearance));
  }, [appearance]);

  return (
    <div
      ref={hostRef}
      data-testid="data-query-editor"
      aria-label={editorLabel}
      className={cn("h-40 shrink-0 resize-y overflow-hidden border-b bg-editor", className)}
    />
  );
}
