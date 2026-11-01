// The TypeScript language service: compiler options, the diagnostics gate while a
// project installs, cross-file go-to-definition, the Problems count, and the
// background models that make cross-file resolution work before a tab is opened.
// Split out of controller.ts (D-019/D-042); dependency .d.ts harvesting lives in
// editor-deps.ts, Python in editor-python.ts.

import type * as Monaco from "monaco-editor";
import { EditorDeps } from "./editor-deps";
import type { KernelBridge } from "./kernel";

/** What the language layer needs from the controller. */
export interface EditorLanguageHost {
  bridge: KernelBridge;
  monaco(): typeof Monaco | null;
  /** The controller's open-model cache (abs -> model). */
  models(): Map<string, Monaco.editor.ITextModel>;
  /** Every open workspace root (dependency types are collected per root). */
  roots(): string[];
  /** A project install/dev server is running: keep the TS worker quiet. */
  isRunningProject(): boolean;
  readFileText(abs: string): Promise<string>;
  /** The tab's language (a hand-picked override wins over the extension). */
  languageOf(abs: string): string;
  openFileAt(abs: string, line?: number, column?: number, length?: number): void;
  consoleLine(text: string, color?: string): void;
  problems(): { errors: number; warnings: number };
  setProblems(problems: { errors: number; warnings: number }): void;
  /** Bring the Python service up when a .py model appears. */
  ensurePythonFor(abs: string): void;
}

export class EditorLanguage {
  private readonly host: EditorLanguageHost;
  private readonly deps: EditorDeps;
  private editorOpener: Monaco.IDisposable | null = null; // cross-file go-to-definition hook
  private compilerOptions: Monaco.typescript.CompilerOptions | null = null;
  /** Whether the TS service may run (off while a project installs). */
  private intelligence = true;

  constructor(host: EditorLanguageHost) {
    this.host = host;
    this.deps = new EditorDeps({
      bridge: host.bridge,
      monaco: host.monaco,
      roots: host.roots,
      consoleLine: host.consoleLine,
      applyExtraLibs: (libs) => this.applyExtraLibs(libs),
    });
  }

  // Turn on the TS/JS language service: sensible compiler options, semantic +
  // syntax diagnostics, and eager model sync so every model we create (open tabs
  // AND the seeded project files) is visible to the worker for cross-file
  // completion/navigation. Installed-package types are fed in separately as extra
  // libs (see loadDependencyTypes).
  configure(monaco: typeof Monaco) {
    const ts = monaco.typescript; // typed re-export of the TS language contribution
    if (!ts) return;
    const compilerOptions: Monaco.typescript.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      // Bundler (TS value 100), not classic NodeJs: our own packages and the generated
      // project resolve through package.json "exports" (subpaths like
      // @facilis/core/i18n). Classic node10 ignores that map, so every such import would
      // be a red TS2307 in the editor. Monaco's enum predates Bundler but the worker's
      // TypeScript (5.9) accepts its numeric value.
      moduleResolution: 100 as Monaco.typescript.ModuleResolutionKind,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      allowNonTsExtensions: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      // Vite templates import with explicit extensions (`import App from "./App.tsx"`);
      // allow it (requires noEmit, which the language service is anyway).
      allowImportingTsExtensions: true,
      noEmit: true,
      // NB: do NOT set an explicit `lib` array — Monaco's worker then fails to load
      // the individual lib.*.d.ts files (DOM globals, iterators… all vanish). Letting
      // `target: ESNext` pick the default `lib.esnext.full.d.ts` (which bundles ESNext
      // + DOM + iterable) is what actually works.
    };
    this.compilerOptions = compilerOptions;
    // Run a SINGLE TS language service. Every JS/TS model uses the `typescript`
    // language (see languageFor) with allowJs, so only the `typescript` ts.worker
    // ever spawns. Monaco otherwise runs a SECOND full language service for the
    // `javascript` mode — a duplicate ~310 MB worker fed the same dependency
    // .d.ts payload. Keep the `javascript` defaults inert (diagnostics off, no
    // eager sync, no extra libs) so its WorkerManager — created lazily on first
    // JS-model use — never starts.
    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    this.applyTsIntelligence(!this.host.isRunningProject());
    ts.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
      onlyVisible: false,
    });
    ts.javascriptDefaults.setEagerModelSync(false);
    // Mirror the worker's markers into a Problems count in the status bar.
    monaco.editor.onDidChangeMarkers(() => this.problems());
  }

  // Whether the TypeScript language service is allowed to run. Off while a
  // project installs.
  //
  // The service lives in ts.worker, a 1.36 MB (brotli) bundle that Monaco spawns
  // the moment diagnostics or eager sync touch a TS model — which, after a
  // create-from-template, is immediately, in the middle of the install. It then
  // competes for bandwidth with the thing the user is actually waiting for, to
  // type-check a project whose `node_modules` does not exist yet: every import
  // is unresolved, so the answers it produces are wrong until the install ends
  // anyway. Turned on by the run finishing, or by the first keystroke — whoever
  // gets there first, because a user who starts editing wants it regardless.
  private applyTsIntelligence(on: boolean) {
    this.intelligence = on;
    const ts = this.host.monaco()?.typescript;
    if (!ts) return;
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: !on,
      noSyntaxValidation: !on,
      onlyVisible: false,
    });
    ts.typescriptDefaults.setEagerModelSync(on);
  }
  /** First keystroke while the service is off turns it back on. */
  enableIntelligence() {
    if (!this.intelligence) this.applyTsIntelligence(true);
  }

  /** Off while a project installs; on when the run finishes (see controller). */
  setIntelligence(on: boolean) {
    this.applyTsIntelligence(on);
  }

  // Wire cross-file "go to definition" (⌘/Ctrl+click, F12) into our tab system.
  // A Monaco standalone editor does NOTHING for a resource other than the model
  // it currently has attached unless an opener is registered — so a definition in
  // another file (or an installed package's .d.ts) silently no-ops. We intercept
  // it and route through openFileAt, which opens/activates the React tab AND
  // reveals the target line/column. (Same-file definitions are handled by Monaco
  // internally and never reach this hook.)
  wireGoToDefinition(monaco: typeof Monaco) {
    if (this.editorOpener) return;
    this.editorOpener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        const abs = resource.path; // Uri.file(abs).path === abs
        let line = 1,
          column = 1,
          length = 0;
        if (selectionOrPosition) {
          if ("startLineNumber" in selectionOrPosition) {
            line = selectionOrPosition.startLineNumber;
            column = selectionOrPosition.startColumn;
            if (selectionOrPosition.endLineNumber === selectionOrPosition.startLineNumber) {
              length = selectionOrPosition.endColumn - selectionOrPosition.startColumn;
            }
          } else {
            line = selectionOrPosition.lineNumber;
            column = selectionOrPosition.column;
          }
        }
        void this.host.openFileAt(abs, line, column, length);
        return true; // handled — suppress Monaco's default no-op
      },
    });
  }

  // Mirror the worker's markers into the status-bar Problems count.
  private problems() {
    const monaco = this.host.monaco();
    if (!monaco) return;
    const Severity = monaco.MarkerSeverity;
    let errors = 0,
      warnings = 0;
    for (const mk of monaco.editor.getModelMarkers({})) {
      if (mk.severity === Severity.Error) errors++;
      else if (mk.severity === Severity.Warning) warnings++;
    }
    const current = this.host.problems();
    if (errors !== current.errors || warnings !== current.warnings) {
      this.host.setProblems({ errors, warnings });
    }
  }

  // Create Monaco models for a folder's own source files so the language service
  // can resolve cross-file imports (and power go-to-definition) even before a
  // file is opened. Bounded, and only creates models that don't already exist —
  // node_modules is excluded from the file index, so this is just user code.
  ensureBackgroundModels(files: string[]) {
    const monaco = this.host.monaco();
    if (!monaco) return;
    let created = 0;
    for (const abs of files) {
      if (created >= 800) break;
      if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(abs)) continue;
      if (this.host.models().has(abs) || monaco.editor.getModel(monaco.Uri.file(abs))) continue;
      created++;
      void this.seedModel(abs);
    }
  }

  private async seedModel(abs: string) {
    const monaco = this.host.monaco();
    if (!monaco || this.host.models().has(abs)) return;
    const uri = monaco.Uri.file(abs);
    if (monaco.editor.getModel(uri)) return;
    const text = await this.host.readFileText(abs);
    // The file may have been opened (→ has a real model) while we awaited the read.
    if (this.host.models().has(abs) || monaco.editor.getModel(uri)) return;
    monaco.editor.createModel(text, this.host.languageOf(abs), uri);
    this.host.ensurePythonFor(abs);
  }

  scheduleDependencyTypes() {
    this.deps.schedule();
  }

  /** Register dependency types, then restart the TS worker so they are seen.
   *  The worker was created before these libs existed; a worker that started
   *  with an empty node_modules view can keep serving stale "Cannot find module"
   *  results. Re-applying the compiler options fires onDidChange, Monaco tears
   *  the worker down, and the next validation starts a fresh LanguageService that
   *  is born seeing every dependency .d.ts. */
  private applyExtraLibs(libs: { filePath: string; content: string }[]) {
    const monaco = this.host.monaco();
    if (!monaco) return;
    monaco.typescript.typescriptDefaults.setExtraLibs(libs);
    if (this.compilerOptions) {
      monaco.typescript.typescriptDefaults.setCompilerOptions(this.compilerOptions);
    }
  }
}
