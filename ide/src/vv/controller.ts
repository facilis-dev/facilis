// IDE controller — the imperative core, ported from the original raw-ESM demo UI (host.js).
//
// React owns the *chrome* (declarative: title bar, activity bar, explorer, tabs,
// status bar, command palette) and subscribes to an immutable snapshot exposed
// here via useSyncExternalStore. This controller owns the *imperative* pieces
// that don't belong in React's render cycle: the kernel worker bridge, the Monaco
// editor + its models, the xterm terminals (Console + interactive shells), the
// project "Run" lifecycle, and the preview wiring. Components hand it DOM mount
// points (editor host, terminal containers, preview iframe) and call its methods.
//
// Since the multi-root rewrite, the workspace is a set of folders (roots), the
// Explorer reads the VFS live, and every open file / tab / model is keyed by its
// ABSOLUTE path so files from different roots never collide.

import { toast } from "sonner";
import { t } from "@/i18n";
import type * as Monaco from "monaco-editor";
import { KernelBridge } from "./kernel";
import { resetOriginState } from "./origin-reset";
import { DebugSession } from "./debug-session";
import { ScmSession } from "./scm-session";
import { EditorStatus } from "./editor-status";
import { loadWordWrap, saveWordWrap } from "./editor-prefs";
import { PROJECTS_KEY, readRegistry, writeRegistry, type ProjectMeta } from "./project-registry";
import { projectName } from "./project-name";
import { ensureProjectOnDisk } from "./project-restore";
import { bootTargetFrom } from "./boot-target";
import { claimProject } from "./project-lock";
import { withTemplateAssets } from "../facilis/project-assets";
import { StatusMessage } from "./status-message";
import type { TemplateManifest } from "./templates";
import { loadTemplates } from "./templates-lazy";
import { markBoot } from "./boot-marks";
import {
  advance,
  fallBackToInstall,
  formatProgress,
  isInstallFallbackLine,
  isRestoreLine,
  readFetchProgress,
  warmRegistryConnection,
  type RunPhase,
} from "./run-phase";
import type { ProgressFn } from "./import-remote";
import { NotebookDoc } from "./notebook/doc.js";
import { CellEditors, type CellEditorSlot } from "./notebook/cell-editors.js";
import { NotebookSession } from "./notebook/session.js";
import { NotebookKernel, isNotebookTerminal } from "./notebook/studio-kernel";
import { languageFor } from "./editor-languages";
import { EditorLanguage, type EditorLanguageHost } from "./editor-language";
import { EditorPython, type EditorPythonHost } from "./editor-python";
import { EditorSession, overflowWidgetsNode, type EditorSessionHost } from "./editor-session";
import { type PreviewHost, type PreviewTab, PreviewSession } from "./preview-session";
import { type TerminalHost, type TerminalMeta, TerminalSession } from "./terminal-session";
import { type UiTheme, monacoThemeFor } from "./terminal-theme";
import { appearanceFromDocument } from "../ui-themes";
import { errText } from "./errors";
import { ProjectExport } from "./project-export";
import { ProjectImport, type ProjectImportHost } from "./project-import";
import {
  type ReplaceParams,
  type ReplaceResult,
  type SearchDone,
  type SearchFileResult,
  type SearchOptions,
  SearchSession,
} from "./search-session";
import { imageMime, isImagePath, isNotebookPath } from "./file-kind";
import { type MemInfo, probeMemory } from "./memory-probe";
import { baseName, normDir, parentOf } from "./path-utils";
import { readDirEntries } from "./file-tree";

// The drop/paste readers live in file-tree.ts now. Components still import them
// from here (this is the UI's facade); the split is controller-mechanical.
export { entriesFromDataTransfer } from "./file-tree";

/** How an open tab renders. Named rather than spelled out at each use: it was
 *  written twice, and adding `notebook` to one of them type-checked everywhere
 *  except the assignment between them. */
export type TabKind = "text" | "image" | "directory" | "diff" | "notebook";

/** One open `.ipynb`: its document, the interpreter running it, and the actions
 *  the view drives. Handed out by `IdeController.notebook(abs)`. */
export interface NotebookHandle {
  readonly abs: string;
  readonly doc: NotebookDoc;
  readonly session: NotebookSession;
  readonly kernel: NotebookKernel;
  /** The cells' Monaco editors and models. Null until the first cell asks for
   *  one, because Monaco is imported on demand. Owned by the HANDLE and not by
   *  the effect that asked — see notebook/cell-editors.js for what went wrong
   *  when it was the other way round. */
  editors: CellEditors | null;
  dispose(): void;
  run(cellId: string): void;
  runSelected(): void;
  runAll(): void;
  interrupt(): void;
  restart(): void;
  /** Move to the cell below after a Shift-Enter, appending one if there is none. */
  focusAfter(cellId: string): void;
  /**
   * Build the editor for one cell. Resolves null — never rejects — when there is
   * no editor to show: either the cell was deleted while Monaco loaded, or the
   * build failed, in which case it has already been reported (status bar +
   * console) rather than dropped. Both cases leave an empty box on screen, and
   * an empty box that says nothing anywhere is how the first version of this
   * feature looked merely "dead".
   */
  createCellEditor(
    el: HTMLElement,
    cellId: string,
    language: "python" | "markdown",
  ): Promise<CellEditorSlot | null>;
}

// The optional network relay is opted into per page load with `?net=ws://…`
// (BootOptions.netRelay). Only a ws:/wss: URL on a LOOPBACK host counts: the
// studio is public, and a relay carries every outbound TCP byte and every inbound
// connection of the VM, so a crafted link naming someone else's relay must not
// be able to route a visitor's VM through it. Anything else is ignored.
function readNetRelayParam(): string | undefined {
  if (typeof location === "undefined") return undefined;
  const raw = new URLSearchParams(location.search).get("net");
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") return undefined;
    const host = u.hostname;
    const loopback =
      host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    return loopback ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

// Validate + normalize the build-time VITE_PREVIEW_ORIGIN (mode B). Returns the
// bare origin (scheme+host+port) of a same-scheme, cross-origin absolute URL, or
// undefined for anything falsy / malformed / same-origin (→ mode A, the default).
function normalizePreviewOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const origin = new URL(raw).origin;
    if (typeof location !== "undefined" && origin === location.origin) return undefined;
    return origin;
  } catch {
    return undefined;
  }
}

// Build-time pop-out behavior (VITE_PREVIEW_POPOUT). Anything other than the
// explicit "isolated" opt-in falls back to the frictionless same-origin default.
function normalizePreviewPopout(raw: string | undefined): "same-origin" | "isolated" {
  return raw === "isolated" ? "isolated" : "same-origin";
}

// Build-time wildcard base domain (VITE_PREVIEW_WILDCARD_DOMAIN, mode C). Returns
// a bare base domain (e.g. "vivari.run") or undefined. When set, previews are
// served one origin per port (`<token>--<port>.<domain>`); takes precedence
// over VITE_PREVIEW_ORIGIN. Unset in the default deploy + local dev (→ mode A/B).
function normalizePreviewWildcardDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let d = raw.trim().toLowerCase();
  try {
    if (d.includes("://")) d = new URL(d).hostname;
  } catch {
    /* fall through */
  }
  d = d.replace(/^\/+|\/+$/g, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : undefined;
}

// Rewrite a keep-prefix template's framework **base** config (`base` / `basename`
// / `baseUrl` / `rootURL` set to `"/preview/<port>/"`) to the origin root `"/"`.
// Keep-prefix templates (Docusaurus, VitePress, Rspress, Starlight, React Router 7,
// TanStack Router, Ember) hardcode that base for the path-multiplexed modes A/B; in
// mode C each port is its OWN origin served at `/`, so the hardcoded base would 404.
// We touch ONLY those config keys, so legitimate cross-service URLs in app code (e.g.
// `'/preview/' + PORT + '/api'`, which still route via the SW/shim in mode C) are
// left intact. `rootURL` is Ember's spelling of the same setting, and it has to be
// listed for the same reason as the others: the template sets Vite `base` AND the
// router's rootURL, and rewriting only the first leaves the router looking for a
// prefix the server no longer serves. It also brings `=` into the separator, because
// Ember writes it as a class field (`rootURL = '/preview/4200/'`) rather than an
// object key — still only ever matched against a literal `/preview/<port>/` value.
function rewritePreviewBaseToRoot(files: Record<string, string>): Record<string, string> {
  const re = /((?:base|basename|baseUrl|rootURL)\s*[:=]\s*)(['"`])\/preview\/\d+\/\2/g;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = content.replace(re, (_m, key: string, q: string) => `${key}${q}/${q}`);
  }
  return out;
}

// ── Demo matrix (UI side) ────────────────────────────────────────────────────
// The two hard-coded example projects the kernel worker still scaffolds on demand
// (the "Run" button's legacy path). New projects come from Home (blank/template).
export interface DemoOption {
  id: string;
  title: string;
  runLabel: string;
}
export const DEMOS: DemoOption[] = [
  { id: "react", title: "React + Vite + React Compiler", runLabel: "npm run dev" },
  { id: "nest", title: "NestJS", runLabel: "npm run start:dev" },
];

export type { TerminalMeta } from "./terminal-session";

export interface PortInfo {
  port: number;
  pid: number;
}

export interface Clipboard {
  mode: "copy" | "cut";
  paths: string[]; // absolute paths of the copied/cut entries (multi-select)
}

// A root folder open in the workspace (VSCode-style multi-root).
export interface WorkspaceFolder {
  id: string;
  name: string;
  rootPath: string; // absolute, no trailing slash
}

// A persisted project (Home "recent projects" list). Content lives in the VFS (OPFS);
// this registry just tracks what exists and when it was last touched. Stored per origin
// and merged across tabs — see project-registry.ts.
export type { ProjectMeta };

export type { PreviewTab } from "./preview-session";

// ── Full-text search (VS Code-style) ─────────────────────────────────────────
// The types and the streaming session live in search-session.ts; re-exported
// here because the pane imports them from the controller (ratchet, D-019).
export type { SearchDone, SearchFileResult, SearchMatch, SearchOptions } from "./search-session";

export interface IdeSnapshot {
  booted: boolean;
  kernelReady: boolean; // kernel + VFS up (can create/open projects) — earlier than `booted`
  // Cold-boot progress shown on Home until `kernelReady`. `bootPhase` is one of
  // "init" | "restore" | "finalize" (""=not started); during "restore",
  // bootDone/bootTotal drive a determinate progress bar (OPFS re-hydration).
  bootPhase: string;
  bootDone: number;
  bootTotal: number;
  // The runtime died on the way up, and is not coming back on its own. Set from
  // the kernel's own fatal `error` and from the bridge's worker-error channel
  // (a kernel worker that never evaluated its module graph). Null in the normal
  // case; when it isn't, Home says so instead of spinning on a progress bar that
  // will never finish — the studio used to have no listener on either channel,
  // so a dead runtime and a slow one looked identical forever.
  bootError: string | null;
  // The project currently installing/starting, if any — what the preview shell
  // and the status bar narrate while there is nothing to preview yet. Null once
  // the preview paints (or the run tab exits).
  runPhase: RunPhase | null;
  view: "home" | "workspace";
  // The project a reloaded tab is booting into (?project=): non-null until the
  // project-opening pass landed it (or gave up and went Home). Drives the blocking
  // overlay that replaces the old Home flash.
  bootProject: string | null;
  // A shared link (#share=) is bootstrapping: show a full-screen blocking overlay.
  shareLoading: boolean;
  shareMessage: string;
  // The "Import from GitHub or npm" dialog is open.
  importRemoteOpen: boolean;
  projectTitle: string | null;
  workspaceFolders: WorkspaceFolder[];
  activeFolderId: string | null;
  recentProjects: ProjectMeta[];
  treeVersion: number; // bump to make the Explorer re-read expanded dirs
  files: string[]; // absolute paths (flat index for quick-open + search)
  openTabs: string[]; // absolute paths
  activeTab: string | null;
  tabKinds: Record<string, TabKind>; // how each open tab renders
  previewTab: string | null; // the single "preview" (italic, single-click) tab
  dirty: string[]; // absolute paths with unsaved edits
  terminals: TerminalMeta[];
  activeTermId: string | null;
  ports: PortInfo[];
  previewTabs: PreviewTab[];
  activePreviewId: string | null;
  devtoolsOpen: boolean; // the chii DevTools panel (bottom split of the preview)
  devtoolsNonce: number; // bump to reload the DevTools frontend (re-attach to a new target)
  selectedDemo: string;
  activeView: "explorer" | "search" | "debug" | "scm" | "chat";
  sidebarCollapsed: boolean;
  panelCollapsed: boolean;
  previewCollapsed: boolean;
  // Soft-wrap long lines in the text editor AND the diff editor. Persisted, since a
  // reload that silently forgot it would read as the toggle not having worked.
  wordWrap: boolean;
  panelTab: "console" | "terminal" | "ports";
  clipboard: Clipboard | null;
  paletteOpen: boolean;
  paletteMode: "command" | "file";
  problems: { errors: number; warnings: number }; // live TS/JS diagnostics (status bar)
  memInfo: MemInfo | null; // last "Measure Memory" result (StatusBar readout)
}

// A diff tab is a synthetic open-tab id: `vv-diff:<abs>`. It reuses the tab strip
// (kind "diff") but must never be treated as a real file path (no read/save). The
// filename still renders because baseName() splits on "/".
const DIFF_PREFIX = "vv-diff:";
export const diffTabId = (abs: string): string => DIFF_PREFIX + abs;
export const isDiffTabId = (id: string | null): boolean => !!id && id.startsWith(DIFF_PREFIX);
export const diffTargetOf = (id: string): string => id.slice(DIFF_PREFIX.length);

// Drag-and-drop wire format: an internal Explorer drag carries the source's
// absolute path under this MIME type; an OS drag carries File entries instead.
export const VV_PATH_MIME = "application/x-vv-path";

// True when the current URL carries a #share= payload (opened a shared link).
function hasSharePayload(): boolean {
  return typeof location !== "undefined" && (location.hash || "").includes("#share=");
}

const folderIdFor = (rootPath: string) => "wf:" + rootPath;

export class IdeController {
  readonly bridge: KernelBridge;
  // Breakpoint debugger session (CDP client for Node guest targets). Drives the
  // Monaco gutter breakpoints, paused-line highlight, and the Debug panel.
  readonly debug: DebugSession;
  // Source Control (git) session — local-only isomorphic-git over the VFS. Drives
  // the Source Control panel + the diff tab.
  readonly scm: ScmSession;
  // Cursor / indentation / language readouts for the status bar. Its own store so
  // per-keystroke cursor updates don't re-render every useIde() consumer.
  readonly editorStatus = new EditorStatus();
  // The status bar's transient message slot. Also its own store: `demo-status`
  // pushes one message per line of dev-server output.
  readonly statusMessage = new StatusMessage();

  // The project this tab boots into (?project=), computed once from the URL: the first
  // paint must already be the workspace, not Home (boot-target.ts). Cleared when the
  // project-opening pass finishes (or gives up) — see clearBootProject().
  private readonly bootTarget = bootTargetFrom(
    typeof location !== "undefined" ? location.search : "",
    typeof location !== "undefined" ? location.hash : "",
  );
  // ── external store ──
  private listeners = new Set<() => void>();
  private snap: IdeSnapshot = {
    booted: false,
    kernelReady: false,
    bootPhase: "init",
    bootDone: 0,
    bootTotal: 0,
    bootError: null,
    runPhase: null,
    // A shared link and a reload of a tab that has a project land straight on the
    // (loading) workspace, never Home — so the user can't accidentally start a new
    // project while it bootstraps, and a reload does not flash the picker.
    view: this.bootTarget.view,
    bootProject: this.bootTarget.project,
    shareLoading: hasSharePayload(),
    shareMessage: "Booting the runtime…",
    importRemoteOpen: false,
    projectTitle: null,
    workspaceFolders: [],
    activeFolderId: null,
    recentProjects: [],
    treeVersion: 0,
    files: [],
    openTabs: [],
    activeTab: null,
    tabKinds: {},
    previewTab: null,
    dirty: [],
    terminals: [],
    activeTermId: null,
    ports: [],
    previewTabs: [],
    activePreviewId: null,
    devtoolsOpen: false,
    devtoolsNonce: 0,
    selectedDemo: DEMOS[0].id,
    activeView: "explorer",
    sidebarCollapsed: false,
    panelCollapsed: true,
    previewCollapsed: false,
    wordWrap: loadWordWrap(),
    panelTab: "console",
    clipboard: null,
    paletteOpen: false,
    paletteMode: "command",
    problems: { errors: 0, warnings: 0 },
    memInfo: null,
  };

  // ── imperative state (not reactive) ──
  // The Console tab and interactive shells (terminal-session.ts).
  readonly terminals: TerminalSession;
  // Project transfer, split into their own modules (project-export/import.ts).
  readonly projectExport: ProjectExport;
  readonly projectImport: ProjectImport;
  // Language service + dependency types + Python provider (editor-*.ts).
  readonly editorLanguage: EditorLanguage;
  readonly editorPython: EditorPython;
  // Monaco (instance, status readouts, actions) lives in editor-session.ts. The
  // getters keep the tab/notebook/diff call sites reading the live instances.
  readonly editorSession: EditorSession;
  private get monaco(): typeof Monaco | null {
    return this.editorSession.monaco();
  }
  private get editor(): Monaco.editor.IStandaloneCodeEditor | null {
    return this.editorSession.editor();
  }
  private models = new Map<string, Monaco.editor.ITextModel>(); // abs -> model
  // Language modes chosen by hand from the status bar (abs -> monaco language id).
  // Re-applied in ensureModel so the choice survives closing + reopening the tab.
  private languageOverrides = new Map<string, string>();
  private diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null; // Source Control diff tab
  private diffModels: Monaco.editor.ITextModel[] = []; // throwaway [original, modified] for the diff editor
  private imageUrls = new Map<string, string>(); // abs -> object URL (image viewer)
  private notebooks = new Map<string, NotebookHandle>(); // abs -> open .ipynb (doc + kernel)
  // Preview panel: multi-tab mini browser + DevTools relay (preview-session.ts).
  readonly preview: PreviewSession;
  private localFiles: Record<string, string> = {}; // abs -> latest saved text (editor cache)
  private pendingReveal: { abs: string; line: number; column: number; length: number } | null =
    null;
  // Full-text search / replace: in-flight token + callbacks (search-session.ts).
  private readonly search: SearchSession;
  private fileIndex = new Map<string, string[]>(); // rootPath -> abs files (quick-open/search)
  private folderManifests = new Map<string, TemplateManifest>(); // rootPath -> run manifest
  private runningProjects = new Map<string, { terminalId: string | null; port: number | null }>();
  private runningDemos = new Map<string, { terminalId: string | null; port: number | null }>();
  private portMap = new Map<number, number>(); // port -> pid (live listeners)
  private treeBump: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  // Current resolved UI theme, seeded from the pre-paint <html> class the
  // no-flash script sets, then kept in sync with next-themes via applyUiTheme.
  private uiTheme: UiTheme = appearanceFromDocument();

  // Preview origin mode (see KernelBridge.mode): "same-origin" (default / local
  // dev), "shared" (mode B, VITE_PREVIEW_ORIGIN) or "wildcard" (mode C,
  // VITE_PREVIEW_WILDCARD_DOMAIN — one origin per port).
  private readonly previewMode: "same-origin" | "shared" | "wildcard";

  constructor() {
    const previewOrigin = normalizePreviewOrigin(import.meta.env.VITE_PREVIEW_ORIGIN);
    const previewPopout = normalizePreviewPopout(import.meta.env.VITE_PREVIEW_POPOUT);
    const previewWildcardDomain = normalizePreviewWildcardDomain(
      import.meta.env.VITE_PREVIEW_WILDCARD_DOMAIN,
    );
    this.bridge = new KernelBridge({ previewOrigin, previewWildcardDomain, previewPopout });
    this.previewMode = this.bridge.mode;
    this.preview = new PreviewSession(this.bridge, this.previewHost());

    this.debug = new DebugSession(this.bridge);
    // When execution pauses (or a frame is selected), open the file + reveal the line.
    this.debug.onReveal = (path, line) => void this.openFileAt(path, line);
    this.scm = new ScmSession(this.bridge);
    // A checkout/discard rewrote the working tree via the silent git RPC (no
    // vv-fs-changed), so refresh the Explorer tree and reload any open editors.
    this.scm.onWorkdirChanged = () => this.reloadWorkdir();
    this.search = new SearchSession(this.bridge, {
      roots: () => this.snap.workspaceFolders.map((f) => f.rootPath),
      refreshFileFromDisk: (abs) => this.refreshFileFromDisk(abs),
    });
    this.snap.recentProjects = readRegistry(localStorage);
    this.watchRegistry();
    this.terminals = new TerminalSession(this.bridge, this.terminalHost());
    this.projectExport = new ProjectExport(this.bridge, {
      status: (text) => this.status(text),
    });
    this.projectImport = new ProjectImport(this.bridge, this.projectImportHost());
    this.editorPython = new EditorPython(this.editorPythonHost());
    this.editorLanguage = new EditorLanguage(this.editorLanguageHost());
    this.editorSession = new EditorSession(this.editorSessionHost());
    this.wireBridge();
    this.preview.wireMessages();
  }

  // ── store plumbing ──
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): IdeSnapshot => this.snap;
  private set(partial: Partial<IdeSnapshot>) {
    const prevActive = this.snap.activePreviewId;
    this.snap = { ...this.snap, ...partial };
    // DevTools follows the active preview tab: re-attach the shared frontend to
    // the new target while the panel is open, or close it with the last tab.
    const follow = this.preview.devtools.followActive(prevActive);
    if (follow) this.snap = { ...this.snap, ...follow };
    for (const l of this.listeners) l();
  }
  /** Post a transient message to the status bar. For routine, high-frequency
   * feedback (a save, a dev-server restart); failures still raise a toast. */
  private status(text: string) {
    this.statusMessage.show(text);
  }
  private syncPorts() {
    this.set({
      ports: [...this.portMap]
        .map(([port, pid]) => ({ port, pid }))
        .sort((a, b) => a.port - b.port),
    });
  }

  // The Preview panel's window onto the controller: its four snapshot fields,
  // the keep-prefix ports of the running projects, and two status hooks.
  private previewHost(): PreviewHost {
    return {
      state: () => ({
        tabs: this.snap.previewTabs,
        activeId: this.snap.activePreviewId,
        devtoolsOpen: this.snap.devtoolsOpen,
        devtoolsNonce: this.snap.devtoolsNonce,
      }),
      update: (patch) => {
        const next: Partial<IdeSnapshot> = {};
        if (patch.tabs !== undefined) next.previewTabs = patch.tabs;
        if (patch.activeId !== undefined) next.activePreviewId = patch.activeId;
        if (patch.devtoolsOpen !== undefined) next.devtoolsOpen = patch.devtoolsOpen;
        if (patch.devtoolsNonce !== undefined) next.devtoolsNonce = patch.devtoolsNonce;
        if (patch.previewCollapsed !== undefined) next.previewCollapsed = patch.previewCollapsed;
        this.set(next);
      },
      keepPrefixPorts: () => {
        const ports: number[] = [];
        for (const [dir, r] of this.runningProjects) {
          if (r.port != null && this.folderManifests.get(dir)?.keepPreviewPrefix)
            ports.push(r.port);
        }
        return ports;
      },
      status: (text) => this.status(text),
      endRunPhase: () => this.endRunPhase(),
    };
  }

  // The terminal runtime's window onto the controller: the panel snapshot
  // fields it publishes, the active folder and the resolved UI theme.
  private terminalHost(): TerminalHost {
    return {
      patch: (patch) => {
        const next: Partial<IdeSnapshot> = {};
        if (patch.terminals !== undefined) next.terminals = patch.terminals;
        if (patch.activeTermId !== undefined) next.activeTermId = patch.activeTermId;
        if (patch.panelTab !== undefined) next.panelTab = patch.panelTab;
        if (patch.panelCollapsed !== undefined) next.panelCollapsed = patch.panelCollapsed;
        this.set(next);
      },
      activeTermId: () => this.snap.activeTermId,
      panelTab: () => this.snap.panelTab,
      activeFolderRoot: () => this.activeFolder?.rootPath ?? null,
      theme: () => this.uiTheme,
    };
  }

  // The importers' window onto the controller: project dirs/validation, the
  // workspace (open a folder/file) and the recent-projects registry.
  private projectImportHost(): ProjectImportHost {
    return {
      kernelReady: () => this.snap.kernelReady,
      set: (patch) => {
        if (patch.importRemoteOpen !== undefined)
          this.set({ importRemoteOpen: patch.importRemoteOpen });
      },
      slug: (name) => this.slug(name),
      defaultDirFor: (name) => this.defaultDirFor(name),
      validateNewDir: (dir) => this.validateNewDir(dir),
      openFolder: (root) => {
        this.openFolder(root);
      },
      openFile: (abs) => {
        void this.openFile(abs);
      },
      registerProjectMeta: (meta) => this.upsertProjectMeta(meta),
      registerManifest: (root, manifest) => {
        this.folderManifests.set(root, manifest);
      },
      status: (text) => this.status(text),
    };
  }

  // The language layer's window onto the controller: the monaco namespace and
  // model cache it drives, the roots it collects types for, and the stores it
  // reports into.
  private editorLanguageHost(): EditorLanguageHost {
    return {
      bridge: this.bridge,
      monaco: () => this.monaco,
      models: () => this.models,
      roots: () => this.snap.workspaceFolders.map((f) => f.rootPath),
      isRunningProject: () => this.snap.runPhase != null,
      readFileText: (abs) => this.readFileText(abs),
      languageOf: (abs) => this.languageOverrides.get(abs) ?? languageFor(abs),
      openFileAt: (abs, line = 1, column = 1, length = 0) =>
        void this.openFileAt(abs, line, column, length),
      consoleLine: (text, color) => this.consoleLine(text, color),
      problems: () => this.snap.problems,
      setProblems: (problems) => this.set({ problems }),
      ensurePythonFor: (abs) => this.editorPython.ensure(abs),
    };
  }

  // The Python provider's window onto the controller.
  private editorPythonHost(): EditorPythonHost {
    return {
      bridge: this.bridge,
      monaco: () => this.monaco,
      roots: () => this.snap.workspaceFolders.map((f) => f.rootPath),
      openFileAt: (path, line, column) => void this.openFileAt(path, line, column),
      status: (text) => this.status(text),
      setServiceState: (label) => this.editorStatus.set({ pythonService: label }),
    };
  }

  // The editor session's window onto the controller.
  private editorSessionHost(): EditorSessionHost {
    return {
      language: this.editorLanguage,
      debug: this.debug,
      editorStatus: this.editorStatus,
      fileIndexLists: () => [...this.fileIndex.values()],
      activeTab: () => this.snap.activeTab,
      openFile: (abs) => void this.openFile(abs),
      wordWrap: () => this.snap.wordWrap,
      appearance: () => this.uiTheme,
      languageOverride: (abs) => this.languageOverrides.get(abs),
      setLanguageOverride: (abs, language) => {
        if (language) this.languageOverrides.set(abs, language);
        else this.languageOverrides.delete(abs);
      },
      languageOf: (abs) => this.languageOverrides.get(abs) ?? languageFor(abs),
    };
  }

  // ── boot ──
  async start() {
    if (this.started) return;
    this.started = true;
    // Opened via a shared link: show a full-screen blocking overlay immediately so
    // the (blank) workspace doesn't look idle while the kernel boots + unpacks.
    if (hasSharePayload()) {
      this.set({ shareLoading: true, shareMessage: "Booting the runtime…" });
      this.status("opening shared project…");
    }
    // Service Worker registration is NOT here — it happens on `kernel-online`
    // (see wireBridge). It was here, and not awaited, for a good reason: the SW is
    // preview-only, the kernel's cross-origin isolation comes from the COOP/COEP
    // response headers rather than from the SW, and making the kernel worker and
    // three Wasm modules queue behind an install/activate bought nothing. But not
    // awaiting it is not the same as it being harmless. Registering it here made
    // the SW activate and call clients.claim() *while the kernel worker's module
    // graph was still streaming in* — measured at ~10ms after the worker was
    // created, on every run. That hands the page a service-worker controller
    // change mid-load, and on Firefox the kernel worker never finished loading
    // afterwards.
    //
    // Nothing needs the SW before the kernel is up: it exists to proxy previews,
    // and there are no previews until a project runs. Preview routing is
    // re-announced on every `listen` (the bridge handler calls
    // `announceKernelHost()`), so a server that binds a port before the SW has
    // claimed still gets routed once it has. Both orderings are equally good for
    // everything the SW actually does, and only one of them has the race — so
    // take the one that does not, rather than trying to survive the transition.
    //
    // `?net=<ws url>` opts into the optional network relay (BootOptions.netRelay):
    // a local agent (`node scripts/net-relay.mjs`) that gives the VM real outbound
    // TCP and binds in-VM listen() ports on the developer's machine. Off otherwise.
    //
    // Every project Home lists is left on OPFS at boot instead of being replayed into
    // this tab's VFS (BootOptions.deferRestoreRoots): a tab pays for the project it
    // opens, not for every project the origin holds. openProject hydrates one.
    // The package-manager cache follows the same rule per FILE
    // (BootOptions.deferCacheFiles): its bodies stay on OPFS and are replayed the
    // first time an install reads them, so a tab does not carry the cache entries of
    // projects it never installs.
    this.bridge.boot(
      true,
      readNetRelayParam(),
      this.snap.recentProjects.map((p) => p.rootPath),
      true,
    );
  }

  /**
   * Resolves once the kernel + VFS are up. Lets UI accept an action before the
   * runtime is ready and queue it, rather than disabling the control and making
   * the user come back to it — the wait is the same either way, but only one of
   * them lets the wait overlap with the user's own thinking.
   */
  whenKernelReady(): Promise<void> {
    if (this.snap.kernelReady) return Promise.resolve();
    return new Promise((resolve) => {
      const off = this.subscribe(() => {
        if (!this.snap.kernelReady) return;
        off();
        resolve();
      });
    });
  }

  // ── VFS queries (request/response over the bridge) ─────────────────────────
  async readdir(absPath: string): Promise<{ name: string; dir: boolean }[]> {
    const m = await this.bridge.request("vv-readdir", { path: absPath });
    return m.ok ? ((m.entries as { name: string; dir: boolean }[]) ?? []) : [];
  }
  async readFileText(absPath: string): Promise<string> {
    const m = await this.bridge.request("vv-read", { path: absPath });
    return m.ok ? String(m.contents ?? "") : "";
  }
  async readFileBytes(absPath: string): Promise<Uint8Array> {
    const m = await this.bridge.request("vv-read-bytes", { path: absPath });
    return m.ok && m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array();
  }
  // The object URL for an open image tab (created lazily in openEntry).
  imageUrlFor(abs: string): string | undefined {
    return this.imageUrls.get(abs);
  }
  async pathInfo(absPath: string): Promise<{ exists: boolean; isDir: boolean }> {
    const m = await this.bridge.request("vv-stat", { path: absPath });
    return { exists: !!m.exists, isDir: !!m.isDir };
  }

  // ── workspace registry (localStorage, one per origin) ──────────────────────
  // Read-merge-write in project-registry.ts: writing this tab's in-memory list used to
  // drop a project another tab had created. The storage event keeps Home live.
  private commitRegistry(changes: { upsert?: ProjectMeta[]; remove?: string[] }) {
    this.set({ recentProjects: writeRegistry(localStorage, changes) });
  }
  private watchRegistry() {
    if (typeof window === "undefined") return;
    window.addEventListener("storage", (event) => {
      if (event.key === PROJECTS_KEY) this.set({ recentProjects: readRegistry(localStorage) });
    });
  }
  private upsertProjectMeta(meta: { rootPath: string; template: string | null }) {
    const now = Date.now();
    const existing = this.snap.recentProjects.find((p) => p.rootPath === meta.rootPath);
    this.commitRegistry({
      upsert: [
        {
          rootPath: meta.rootPath,
          template: meta.template,
          createdAt: existing?.createdAt ?? now,
          lastModified: now,
        },
      ],
    });
  }
  private touchProject(rootPath: string) {
    const entry = this.snap.recentProjects.find((p) => p.rootPath === rootPath);
    if (entry) this.commitRegistry({ upsert: [{ ...entry, lastModified: Date.now() }] });
  }
  removeProjectMeta(rootPath: string) {
    this.commitRegistry({ remove: [rootPath] });
  }

  /**
   * Delete a project from this origin: its files from the VFS (and therefore the OPFS
   * mirror) and its entry in the recent list.
   *
   * A project's subtree is normally still deferred in the mirror (D-036), so a bare
   * `vv-rm` would find nothing in this tab's VFS and leave the files on OPFS — which is
   * exactly why the old "remove from list" button looked like a delete that did not
   * delete. Hydrating first makes the recursive rm see the tree, and every unlink/rmdir
   * then reaches the mirror (fs-server calls persistence.onDelete).
   *
   * A project another live tab has claimed is refused: that tab holds the tree in RAM and
   * its write-behind mirror would recreate what we just deleted. The claim is the same Web
   * Lock the tab bootstrap uses; an open folder in THIS tab is already ours.
   */
  async deleteProject(rootPath: string): Promise<boolean> {
    const root = normDir(rootPath);
    const name = projectName(root);
    const open = this.snap.workspaceFolders.find((f) => f.rootPath === root);
    const claim = open ? null : await claimProject(root);
    if (!open && !claim) {
      toast.error(t("project.openElsewhere", { name }));
      return false;
    }
    try {
      // Close the project (and stop its dev server) before its directory disappears, so
      // no editor model or write-behind flush can race the delete.
      if (open) this.closeFolder(open.id);
      const running = this.runningProjects.get(root);
      if (running?.terminalId && this.terminals.has(running.terminalId)) {
        this.terminals.closeTerminal(running.terminalId);
      }
      this.runningProjects.delete(root);
      const onDisk = await ensureProjectOnDisk(
        this.bridge,
        root,
        (p) => this.pathInfo(p),
        (line) => this.status(line),
      );
      if (onDisk) {
        const res = await this.bridge.request("vv-rm", { path: root });
        if (!res.ok) throw new Error(String(res.error ?? "unknown error"));
      }
      this.folderManifests.delete(root);
      this.removeProjectMeta(root);
      this.status(t("project.deleted", { name }));
      return true;
    } catch (err) {
      toast.error(t("project.deleteFailed", { name, error: errText(err) }));
      return false;
    } finally {
      claim?.release();
    }
  }

  // ── console output ────────────────────────────────────────────────────────
  // The Console tab itself lives in terminal-session.ts; these two wrappers are
  // how the rest of the controller narrates boot/run progress into it.
  private consoleWrite(chunk: string) {
    this.terminals.consoleWrite(chunk);
  }
  private consoleLine(text: string, color?: string) {
    this.terminals.consoleLine(text, color);
  }
  // Switch the editor + all live terminals to the given resolved theme. Called
  // from a React effect that mirrors next-themes' resolvedTheme.
  applyUiTheme(theme: UiTheme) {
    if (theme === this.uiTheme) return;
    this.uiTheme = theme;
    this.editorSession.applyTheme(theme);
    this.terminals.applyTheme(theme);
  }

  setActiveView(view: "explorer" | "search" | "debug" | "scm" | "chat") {
    this.set({ activeView: view, sidebarCollapsed: false });
    // Opening Source Control: point it at all workspace folders and refresh NOW.
    // Status walks only run while the panel is shown (they contend with the terminal
    // on the kernel worker thread), so this on-demand refresh is where they happen.
    if (view === "scm") {
      this.syncScmRoots();
      void this.scm.refresh();
    }
  }

  /** Keep the Source Control panel's repo list in sync with the open workspace
   * folders (one repo section per folder, like VS Code). */
  private syncScmRoots() {
    this.scm.setRoots(this.snap.workspaceFolders.map((f) => ({ root: f.rootPath, name: f.name })));
  }

  /** Re-read git after the workspace changed. A full status walk only happens while
   * the Source Control panel is shown; otherwise we just resolve each repo's branch,
   * which is all the status bar needs and costs a `.git/HEAD` read. */
  private refreshScm() {
    if (this.snap.activeView === "scm") void this.scm.refresh();
    else void this.scm.refreshBranches();
  }

  // React hands us the container for a terminal tab; mount xterm into it once.
  mountTerminal(id: string, el: HTMLElement | null) {
    const t = this.terminals.entry(id);
    if (!t || !el) return;
    if (t.opened) {
      // Re-parent if React remounted the node.
      if (t.term.element && t.term.element.parentElement !== el) el.appendChild(t.term.element);
      return;
    }
    t.term.open(el);
    t.opened = true;
    requestAnimationFrame(() => {
      try {
        t.fit.fit();
      } catch {
        /* hidden */
      }
    });
  }

  fitTerminal(id: string | null) {
    if (!id) return;
    const t = this.terminals.entry(id);
    if (!t) return;
    try {
      t.fit.fit();
    } catch {
      /* hidden */
    }
  }

  clearActiveTerminal() {
    const id = this.snap.panelTab === "console" ? "console" : this.snap.activeTermId;
    this.terminals.entry(id ?? "")?.term.clear();
  }

  // ── editor ──────────────────────────────────────────────────────────────
  // The Monaco instance, its status readouts and the editor actions live in
  // editor-session.ts; this is the panel's entry point.
  async mountEditor(el: HTMLElement) {
    await this.editorSession.mount(el);
  }

  // Status-bar actions, delegated to the editor session (which owns Monaco).
  gotoLine(line: number, column = 1) {
    this.editorSession.gotoLine(line, column);
  }
  setLanguageMode(id: string | null) {
    this.editorSession.setLanguageMode(id);
  }
  setIndentation(opts: { insertSpaces?: boolean; tabSize?: number }) {
    this.editorSession.setIndentation(opts);
  }
  detectIndentation() {
    this.editorSession.detectIndentation();
  }
  runEditorAction(id: string) {
    this.editorSession.runEditorAction(id);
  }

  // Ensure a Monaco model exists for `abs` (loading its content from the VFS on
  // first open). Wires dirty tracking against the last-saved text.
  private async ensureModel(abs: string): Promise<Monaco.editor.ITextModel | null> {
    if (!this.monaco) return null;
    const cached = this.models.get(abs);
    if (cached) return cached;
    if (!(abs in this.localFiles)) this.localFiles[abs] = await this.readFileText(abs);
    const monaco = this.monaco;
    const uri = monaco.Uri.file(abs);
    // A language mode picked by hand from the status bar wins over the extension.
    const language = this.languageOverrides.get(abs) ?? languageFor(abs);
    const existing = monaco.editor.getModel(uri);
    const model = existing ?? monaco.editor.createModel(this.localFiles[abs] ?? "", language, uri);
    // A background/seeded model already exists (created with the auto-detected
    // language) — re-apply the override so reopening the tab keeps the choice.
    if (existing && existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language);
    }
    // Opening a Python file is what brings the language service up. Also called
    // from seedModel, so a background model counts too: by the time someone
    // clicks the tab, the interpreter has had a head start.
    if (language === "python") this.editorPython.ensure(abs);
    model.onDidChangeContent(() => {
      const changed = model.getValue() !== (this.localFiles[abs] ?? "");
      const isDirty = this.snap.dirty.includes(abs);
      if (changed && !isDirty) this.set({ dirty: [...this.snap.dirty, abs] });
      else if (!changed && isDirty) this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
      if (changed && this.snap.previewTab === abs) this.set({ previewTab: null }); // editing pins the tab
    });
    this.models.set(abs, model);
    return model;
  }

  // Open any Explorer entry by ABSOLUTE path, choosing how it renders: a
  // directory shows the "…is a directory" message, an image opens the image
  // viewer, everything else opens in Monaco. Use this (not openFile) wherever a
  // path could be a folder or an image (Explorer clicks, drag-to-editor).
  async openEntry(
    abs: string,
    { preview = false, focus = true }: { preview?: boolean; focus?: boolean } = {},
  ) {
    let kind = this.snap.tabKinds[abs];
    if (!kind) {
      const info = await this.pathInfo(abs);
      kind = info.isDir
        ? "directory"
        : isImagePath(abs)
          ? "image"
          : isNotebookPath(abs)
            ? "notebook"
            : "text";
      this.set({ tabKinds: { ...this.snap.tabKinds, [abs]: kind } });
    }
    if (kind === "image" && !this.imageUrls.has(abs)) {
      const bytes = await this.readFileBytes(abs);
      this.imageUrls.set(
        abs,
        URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(abs) })),
      );
    }
    // A notebook is opened (and, if it will not parse, downgraded to text) in
    // openFile, which is where every other way of opening a file also lands.
    await this.openFile(abs, { preview, focus });
  }

  // Open a file by ABSOLUTE path. `preview` (single-click from the Explorer)
  // reuses a single italic "preview" tab; a permanent open (double-click, or an
  // edit) pins it.
  async openFile(
    abs: string,
    { preview = false, focus = true }: { preview?: boolean; focus?: boolean } = {},
  ) {
    // A diff tab carries no real file — just activate it; EditorGroup mounts the
    // Monaco diff editor. Detach the standard editor so it doesn't show stale text.
    if (isDiffTabId(abs)) {
      if (!this.snap.openTabs.includes(abs)) return;
      this.set({ activeTab: abs });
      if (this.editor) this.editor.setModel(null);
      return;
    }
    // Reconcile the tab strip + preview slot.
    const already = this.snap.openTabs.includes(abs);
    let openTabs = this.snap.openTabs;
    let previewTab = this.snap.previewTab;
    if (preview) {
      if (already) {
        // existing tab — activate it; a permanent tab stays permanent.
      } else if (previewTab && this.snap.openTabs.includes(previewTab)) {
        openTabs = this.snap.openTabs.map((t) => (t === previewTab ? abs : t)); // reuse the slot
        previewTab = abs;
      } else {
        openTabs = [...this.snap.openTabs, abs];
        previewTab = abs;
      }
    } else {
      if (!already) openTabs = [...this.snap.openTabs, abs];
      if (previewTab === abs) previewTab = null; // promote to permanent
    }
    this.set({ openTabs, previewTab, activeTab: abs });

    // A `.ipynb` has to become a notebook tab HERE and not only in openEntry.
    // openEntry is the Explorer's path, and it is far from the only one: ⌘P, a
    // template's `entry` after create, and restoring a tab on reload all arrive
    // straight at openFile — which would have shown the notebook's raw JSON.
    // A notebook that will not parse falls back to text, the one view that can
    // repair it.
    // `!== "text"` rather than "has no kind": a notebook that failed to parse was
    // downgraded once already, and must not be retried on every tab switch.
    if (isNotebookPath(abs) && this.snap.tabKinds[abs] !== "text" && !this.notebooks.has(abs)) {
      const opened = await this.openNotebook(abs);
      this.set({ tabKinds: { ...this.snap.tabKinds, [abs]: opened ? "notebook" : "text" } });
    }

    if (!this.editor || !this.monaco) return; // editor still loading — intent remembered
    // Image / directory / notebook tabs don't get a Monaco model — the EditorGroup
    // renders a custom pane. Detach the editor's model so it doesn't show stale text.
    const kind = this.snap.tabKinds[abs] ?? "text";
    if (kind !== "text") {
      if (this.snap.activeTab === abs) this.editor.setModel(null);
      return;
    }
    const model = await this.ensureModel(abs);
    if (model && this.snap.activeTab === abs) {
      this.editor.setModel(model);
      if (focus) this.editor.focus();
      if (this.pendingReveal && this.pendingReveal.abs === abs) {
        const r = this.pendingReveal;
        this.pendingReveal = null;
        this.editorSession.reveal(r.line, r.column, r.length);
      }
    }
  }

  // Open a file and jump to a 1-based line/column, selecting `length` chars (used
  // by Search results + quick-open's `:line` suffix). If the editor is still
  // loading, the reveal is remembered and applied once its model is set.
  async openFileAt(abs: string, line: number, column = 1, length = 0) {
    this.pendingReveal = { abs, line, column, length };
    await this.openFile(abs);
    if (this.pendingReveal && this.pendingReveal.abs === abs && this.editor) {
      this.pendingReveal = null;
      this.editorSession.reveal(line, column, length);
    }
  }

  // ── full-text search / replace (delegated to the kernel worker) ─────────────
  // The streaming state and the kernel protocol live in search-session.ts.
  runSearch(
    opts: SearchOptions,
    cb: { onBatch: (files: SearchFileResult[]) => void; onDone: (d: SearchDone) => void },
  ): () => void {
    return this.search.run(opts, cb);
  }

  async replace(params: ReplaceParams): Promise<ReplaceResult> {
    return this.search.replace(params);
  }

  // Re-sync an open model + cache with the VFS after an out-of-band write.
  private async refreshFileFromDisk(abs: string) {
    const text = await this.readFileText(abs);
    this.localFiles[abs] = text;
    const model = this.models.get(abs);
    if (model && model.getValue() !== text) model.setValue(text);
    if (this.snap.dirty.includes(abs))
      this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
  }

  // Double-clicking a preview tab (or Explorer entry) pins it permanently.
  pinTab(abs: string) {
    if (this.snap.previewTab === abs) this.set({ previewTab: null });
  }

  // Reorder the open-tabs strip (VSCode-style drag): move `fromAbs` to sit
  // immediately before/after `toAbs`. Doesn't change which tab is active.
  reorderTab(fromAbs: string, toAbs: string, placeAfter: boolean) {
    if (fromAbs === toAbs) return;
    const tabs = [...this.snap.openTabs];
    const fromIdx = tabs.indexOf(fromAbs);
    if (fromIdx === -1) return;
    tabs.splice(fromIdx, 1);
    let toIdx = tabs.indexOf(toAbs);
    if (toIdx === -1) return;
    if (placeAfter) toIdx += 1;
    tabs.splice(toIdx, 0, fromAbs);
    this.set({ openTabs: tabs });
  }

  // Revoke + forget an image tab's object URL (freeing the decoded bitmap).
  private revokeImage(abs: string) {
    const url = this.imageUrls.get(abs);
    if (url) {
      URL.revokeObjectURL(url);
      this.imageUrls.delete(abs);
    }
  }
  // Drop the render-kind entry for a closed/removed tab (image URLs revoked too).
  private forgetKind(abs: string): Record<string, TabKind> {
    this.revokeImage(abs);
    if (!(abs in this.snap.tabKinds)) return this.snap.tabKinds;
    const next = { ...this.snap.tabKinds };
    delete next[abs];
    return next;
  }

  closeTab(abs: string) {
    const i = this.snap.openTabs.indexOf(abs);
    if (i === -1) return;
    // Closing a notebook stops its interpreter. A kernel with no window is a
    // process holding a Pyodide heap that nothing can reach or stop.
    const nb = this.notebooks.get(abs);
    if (nb) {
      nb.dispose();
      this.notebooks.delete(abs);
    }
    const openTabs = this.snap.openTabs.filter((x) => x !== abs);
    const previewTab = this.snap.previewTab === abs ? null : this.snap.previewTab;
    const tabKinds = this.forgetKind(abs);
    if (this.snap.activeTab === abs) {
      const next = openTabs[i] || openTabs[i - 1] || null;
      this.set({ openTabs, previewTab, tabKinds, activeTab: next });
      if (next) void this.openFile(next);
      else this.editor?.setModel(null);
    } else {
      this.set({ openTabs, previewTab, tabKinds });
    }
  }

  // Persist a file to the VFS (⌘S, or "Save" in the close prompt). The dev server
  // hot-updates/recompiles off the resulting notifyWatch.
  saveFile(abs: string) {
    if (!this.snap.dirty.includes(abs)) return;
    // A notebook's text is generated from its cells, not held in a Monaco buffer.
    if (this.saveNotebook(abs)) return;
    const contents = this.models.get(abs)?.getValue() ?? this.localFiles[abs] ?? "";
    this.localFiles[abs] = contents;
    this.bridge.post("vv-write", { path: abs, contents });
    const folder = this.folderForPath(abs);
    if (folder) this.touchProject(folder.rootPath);
    const reload = folder ? this.folderManifests.get(folder.rootPath)?.reload : false;
    this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
    this.status(
      reload ? `saved ${baseName(abs)} — recompiling…` : `saved ${baseName(abs)} — hot-updating…`,
    );
  }

  // ── notebooks ──────────────────────────────────────────────────────────────
  //
  // A `.ipynb` opens as a notebook tab rather than as the JSON it is on disk.
  // The document, the execution queue and the format live in `vv/notebook/*.js`,
  // which `scripts/spike-notebook.mjs` drives directly; what is here is the part
  // that needs the studio — the VFS, Monaco, and the terminal the kernel runs in.

  /** Open (or reuse) the notebook for `abs`. False if the file will not parse,
   *  which sends the caller back to the text editor. */
  async openNotebook(abs: string): Promise<boolean> {
    if (this.notebooks.has(abs)) return true;
    if (!(abs in this.localFiles)) this.localFiles[abs] = await this.readFileText(abs);
    let doc: NotebookDoc;
    try {
      const text = this.localFiles[abs] ?? "";
      doc = text.trim() ? NotebookDoc.fromText(text) : new NotebookDoc();
    } catch (err) {
      this.status(
        `${baseName(abs)} is not a notebook this can open (${(err as Error).message}) — showing the raw file`,
      );
      return false;
    }
    const handle = this.makeNotebook(abs, doc);
    this.notebooks.set(abs, handle);
    return true;
  }

  /** The handle for an open notebook, for the view. */
  notebook(abs: string): NotebookHandle | null {
    return this.notebooks.get(abs) ?? null;
  }

  /** Which open notebook owns a terminal id, if any. */
  private notebookTerminal(terminalId: string): NotebookHandle | null {
    if (!isNotebookTerminal(terminalId)) return null;
    for (const h of this.notebooks.values()) if (h.kernel.terminalId === terminalId) return h;
    return null;
  }

  private makeNotebook(abs: string, doc: NotebookDoc): NotebookHandle {
    const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
    const kernel = new NotebookKernel({
      bridge: this.bridge,
      cwd: this.folderForPath(abs)?.rootPath ?? dir,
      onOutput: (chunk) => session.feed(chunk),
      onExit: (code) => {
        const alive = session.status !== "off";
        session.onExit(code);
        // The status bar, as well as the notebook's own banner. A kernel dying is
        // the kind of thing a user should not have to be looking at the right tab
        // to find out about — and for a long time it produced no report anywhere,
        // because the shell outlived the kernel and this never even ran.
        if (!alive) return;
        const why = session.exit?.ename
          ? `${session.exit.ename}${session.exit.evalue ? `: ${session.exit.evalue}` : ""}`
          : `exit code ${code}`;
        this.status(
          `${baseName(abs)} — the Python kernel stopped (${why}); press Restart to run cells again`,
        );
      },
    });
    const session = new NotebookSession(kernel, doc.sink());

    // The notebook's dirty flag rides the same tab-strip state as a text file's,
    // so ⌘S, the close prompt and the dot on the tab all work unchanged.
    const unsubscribe = doc.subscribe(() => {
      const isDirty = this.snap.dirty.includes(abs);
      if (doc.dirty && !isDirty) this.set({ dirty: [...this.snap.dirty, abs] });
      else if (!doc.dirty && isDirty) this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
      if (doc.dirty && this.snap.previewTab === abs) this.set({ previewTab: null });
    });

    const handle: NotebookHandle = {
      abs,
      doc,
      session,
      kernel,
      dispose: () => {
        unsubscribe();
        session.shutdown();
        handle.editors?.disposeAll();
        handle.editors = null;
      },
      editors: null,
      run: (id) => {
        const cell = doc.cell(id);
        if (!cell) return;
        if (cell.type !== "code") {
          // Not silence. The toolbar's Run is `runSelected`, and a freshly opened
          // notebook's selection is its FIRST cell — which is markdown in every
          // template we ship, including the one the Python project starts with.
          // So the most obvious button in the notebook did nothing at all, and
          // said nothing about why, which reads as a broken kernel rather than as
          // a cell with nothing to run.
          this.status("markdown cells have nothing to run — select a code cell, or press its ▶");
          return;
        }
        // The model is the truth while a cell is being typed in: `setSource` runs
        // on change, but reading it here means a Run never sends stale text.
        const model = handle.editors?.modelFor(id);
        if (model) doc.setSource(id, model.getValue());
        session.run(id, doc.cell(id)?.source ?? "");
      },
      runSelected: () => {
        if (doc.selected) handle.run(doc.selected);
      },
      runAll: () => {
        for (const cell of doc.cells) if (cell.type === "code") handle.run(cell.id);
      },
      interrupt: () => {
        if (!session.interrupt()) this.status("nothing is running to interrupt");
      },
      restart: () => {
        session.restart();
        this.status(`${baseName(abs)} — restarting the interpreter`);
      },
      focusAfter: (id) => {
        const next = doc.cells[doc.indexOf(id) + 1];
        if (next) doc.select(next.id);
        else doc.insert("code");
      },
      createCellEditor: (el, id, language) =>
        this.createCellEditor(handle, el, id, language).catch((err: unknown) => {
          // There is no error state for a cell. A cell whose editor did not get
          // built renders as an empty bordered box and nothing else happens —
          // which is indistinguishable, on screen, from a notebook that is simply
          // broken. This promise had no rejection handler at all, anywhere, so
          // whatever threw inside it never reached the console either.
          console.error(
            `[notebook] ${baseName(abs)}: could not build the editor for cell ${id}`,
            err,
          );
          this.status(`${baseName(abs)} — a cell editor failed to load (details in the console)`);
          return null;
        }),
    };
    return handle;
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
  private async createCellEditor(
    handle: NotebookHandle,
    el: HTMLElement,
    id: string,
    language: "python" | "markdown",
  ): Promise<CellEditorSlot | null> {
    const monaco = await this.editorSession.ensureMonaco();
    // The one benign null: the cell was deleted while Monaco was loading, so
    // there is nothing to build. Everything else throws and is reported by the
    // wrapper in makeNotebook.
    const cell = handle.doc.cell(id);
    if (!cell) return null;
    const editors = (handle.editors ??= new CellEditors(monaco, handle.abs));
    if (language === "python") this.editorPython.ensure(editors.uriFor(id, language).path);
    return editors.mount(el, id, language, cell.source, {
      theme: monacoThemeFor(this.uiTheme),
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      // A notebook renders in the same pane as the text editor, so its cells have
      // the same preview iframe beside them. `cellEditorOptions` already sets
      // `fixedOverflowWidgets` for its own reasons; supplying the host here is
      // what carries the widget out of the pane. Passed in rather than imported
      // by cell-editors.js, which takes Monaco as a parameter precisely so it
      // stays drivable without a DOM.
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
  }

  /** ⌘S on a notebook tab: serialise the document rather than a Monaco buffer. */
  private saveNotebook(abs: string): boolean {
    const handle = this.notebooks.get(abs);
    if (!handle) return false;
    const contents = handle.doc.toText();
    this.localFiles[abs] = contents;
    this.bridge.post("vv-write", { path: abs, contents });
    handle.doc.dirty = false;
    handle.doc.changed({ dirty: false });
    this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
    this.status(`saved ${baseName(abs)}`);
    return true;
  }

  // ── Source Control: diff tab + working-tree reload ──

  /** Open a read-only diff (HEAD ↔ working tree) for a file as its own tab. */
  openDiff(abs: string) {
    const id = diffTabId(abs);
    const openTabs = this.snap.openTabs.includes(id)
      ? this.snap.openTabs
      : [...this.snap.openTabs, id];
    const tabKinds = { ...this.snap.tabKinds, [id]: "diff" as const };
    this.set({ openTabs, tabKinds, activeTab: id, previewTab: null });
  }

  /** Mount (or re-target) the Monaco diff editor for a diff tab. Called by the
   * EditorGroup's DiffView, which remounts per diff tab (keyed by tab id). */
  async mountDiffEditor(el: HTMLElement, id: string) {
    const abs = diffTargetOf(id);
    const monaco = await this.editorSession.ensureMonaco();
    // One diff editor instance, rebound per mount. Dispose the previous editor +
    // its throwaway models so we don't leak on every open.
    this.disposeDiffEditor();
    const diff = monaco.editor.createDiffEditor(el, {
      readOnly: true,
      automaticLayout: true,
      theme: monacoThemeFor(this.uiTheme),
      fontSize: 13,
      minimap: { enabled: false },
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      // Wrapping matters MORE here than in the text editor: a side-by-side diff gives
      // each version half the width, so a long line is cut off twice over.
      wordWrap: this.snap.wordWrap ? "on" : "off",
      // Same pane, same preview iframe next to it — see overflowWidgetsNode.
      fixedOverflowWidgets: true,
      overflowWidgetsDomNode: overflowWidgetsNode(),
    });
    this.diffEditor = diff;
    const [head, work] = await Promise.all([
      this.scm.headBlobText(abs),
      this.readFileText(abs).catch(() => ""),
    ]);
    // A resume/tab-switch may have torn this editor down while we awaited.
    if (this.diffEditor !== diff) return;
    const lang = languageFor(abs);
    const original = monaco.editor.createModel(head, lang);
    const modified = monaco.editor.createModel(work, lang);
    this.diffModels = [original, modified];
    diff.setModel({ original, modified });
  }

  private disposeDiffEditor() {
    this.diffEditor?.dispose();
    this.diffEditor = null;
    for (const m of this.diffModels) m.dispose();
    this.diffModels = [];
  }

  /** After a checkout/discard rewrote files via the silent git RPC, refresh the
   * Explorer tree and reload any open editor models whose bytes changed on disk. */
  private async reloadWorkdir() {
    this.bumpTree();
    for (const abs of this.snap.openTabs) {
      if (isDiffTabId(abs)) continue;
      if ((this.snap.tabKinds[abs] ?? "text") !== "text") continue;
      const model = this.models.get(abs);
      if (!model) continue;
      try {
        const text = await this.readFileText(abs);
        this.localFiles[abs] = text;
        if (model.getValue() !== text) model.setValue(text);
      } catch {
        /* the checkout may have deleted this file — leave the stale buffer */
      }
    }
  }

  saveActiveFile() {
    if (this.snap.activeTab) this.saveFile(this.snap.activeTab);
  }

  // Throw away unsaved edits, reverting the model to the last-saved text.
  discardFile(abs: string) {
    const nb = this.notebooks.get(abs);
    if (nb) {
      // Rebuilt from the saved bytes rather than undone cell by cell: the edits
      // being discarded include inserts, deletes and reorders, which no per-model
      // revert would put back.
      nb.dispose();
      this.notebooks.delete(abs);
      this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
      void this.openNotebook(abs);
      return;
    }
    const model = this.models.get(abs);
    const saved = this.localFiles[abs] ?? "";
    if (model && model.getValue() !== saved) model.setValue(saved); // fires onDidChangeContent → clears dirty
    this.set({ dirty: this.snap.dirty.filter((x) => x !== abs) });
  }

  // ── workspace folders ──────────────────────────────────────────────────────
  get activeFolder(): WorkspaceFolder | null {
    return this.snap.workspaceFolders.find((f) => f.id === this.snap.activeFolderId) ?? null;
  }
  private folderForPath(abs: string): WorkspaceFolder | null {
    let best: WorkspaceFolder | null = null;
    for (const f of this.snap.workspaceFolders) {
      if (abs === f.rootPath || abs.startsWith(f.rootPath + "/")) {
        if (!best || f.rootPath.length > best.rootPath.length) best = f;
      }
    }
    return best;
  }

  // Show a project in this tab (or focus it if it is already the tab's project).
  //
  // A tab is ONE project (D-035): opening another replaces the tab's root instead of
  // stacking a second one, and the label is the directory's name — never a caller-supplied
  // title, which could disagree with the folder the tab, Web Lock and ?project= name.
  openFolder(rootPath: string): WorkspaceFolder {
    const root = normDir(rootPath);
    const id = folderIdFor(root);
    this.snap.workspaceFolders.filter((f) => f.id !== id).forEach((f) => this.closeFolder(f.id));
    let folder = this.snap.workspaceFolders.find((f) => f.id === id);
    if (!folder) {
      folder = { id, name: projectName(root), rootPath: root };
      this.set({ workspaceFolders: [...this.snap.workspaceFolders, folder] });
    }
    this.set({
      activeFolderId: id,
      view: "workspace",
      projectTitle: folder.name,
      treeVersion: this.snap.treeVersion + 1,
    });
    void this.indexFolder(root);
    this.syncScmRoots();
    this.refreshScm();
    return folder;
  }

  closeFolder(id: string) {
    const folder = this.snap.workspaceFolders.find((f) => f.id === id);
    if (!folder) return;
    const root = folder.rootPath;
    // Drop the folder's open tabs/models + its file index.
    const tabKinds = { ...this.snap.tabKinds };
    for (const abs of Array.from(this.snap.openTabs)) {
      if (abs === root || abs.startsWith(root + "/")) {
        this.disposeModel(abs);
        delete this.localFiles[abs];
        this.revokeImage(abs);
        delete tabKinds[abs];
      }
    }
    const keep = (p: string) => !(p === root || p.startsWith(root + "/"));
    const openTabs = this.snap.openTabs.filter(keep);
    const activeTab =
      this.snap.activeTab && keep(this.snap.activeTab)
        ? this.snap.activeTab
        : (openTabs[openTabs.length - 1] ?? null);
    this.fileIndex.delete(root);
    this.folderManifests.delete(root);
    const folders = this.snap.workspaceFolders.filter((f) => f.id !== id);
    const activeFolderId =
      this.snap.activeFolderId === id
        ? (folders[folders.length - 1]?.id ?? null)
        : this.snap.activeFolderId;
    this.set({
      workspaceFolders: folders,
      activeFolderId,
      openTabs,
      activeTab,
      tabKinds,
      previewTab: this.snap.previewTab && keep(this.snap.previewTab) ? this.snap.previewTab : null,
      dirty: this.snap.dirty.filter(keep),
      files: this.rebuildFileIndex(),
      view: folders.length ? "workspace" : "home",
      projectTitle: folders.length
        ? (folders.find((f) => f.id === activeFolderId)?.name ?? null)
        : null,
    });
    if (activeTab) void this.openFile(activeTab);
    else this.editor?.setModel(null);
    // A folder was removed: drop its Source Control section.
    this.syncScmRoots();
    this.refreshScm();
  }

  setActiveFolder(id: string) {
    const f = this.snap.workspaceFolders.find((x) => x.id === id);
    if (f) {
      this.set({ activeFolderId: id, projectTitle: f.name });
    }
  }

  // Recursively index a folder's files (skipping heavy dirs) for quick-open +
  // filename search. Bounded so a giant tree can't lock up the UI.
  private async indexFolder(root: string) {
    const skip = new Set(["node_modules", ".git", "dist", ".vite", ".next", "build", ".cache"]);
    const out: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 8 || out.length > 4000) return;
      const entries = await this.readdir(dir);
      for (const e of entries) {
        const abs = dir + "/" + e.name;
        if (e.dir) {
          if (!skip.has(e.name)) await walk(abs, depth + 1);
        } else {
          out.push(abs);
        }
      }
    };
    await walk(root, 0);
    this.fileIndex.set(root, out);
    this.set({ files: this.rebuildFileIndex() });
    // Feed the language service: this folder's source files (cross-file
    // IntelliSense) + a debounced refresh of installed-package types.
    this.editorLanguage.ensureBackgroundModels(out);
    this.editorLanguage.scheduleDependencyTypes();
  }
  private rebuildFileIndex(): string[] {
    const all: string[] = [];
    for (const list of this.fileIndex.values()) all.push(...list);
    return all.sort();
  }

  // ── project creation / opening (Home) ──────────────────────────────────────
  private slug(name: string): string {
    return (
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "") || "project"
    );
  }
  // A sensible default directory for a new project of the given name.
  defaultDirFor(name: string): string {
    return "/home/user/projects/" + this.slug(name);
  }

  // Validate a target directory for a NEW project. Returns an error string or null.
  async validateNewDir(dir: string): Promise<string | null> {
    const abs = normDir(dir);
    if (!abs.startsWith("/")) return "Path must be absolute (start with /).";
    if (abs === "/" || this.snap.workspaceFolders.some((f) => f.rootPath === abs))
      return "That directory is already open in the workspace.";
    // Re-read rather than trust the snapshot: another tab may have created it a moment
    // ago and the storage event may not have arrived yet.
    if (readRegistry(localStorage).some((p) => p.rootPath === abs))
      return "A project already exists at that path.";
    const info = await this.pathInfo(abs);
    if (info.exists && !info.isDir) return "A file already exists at that path.";
    if (info.exists && info.isDir) {
      const entries = await this.readdir(abs);
      if (entries.length) return "That directory is not empty.";
    }
    return null;
  }

  async createBlankProject({ dir }: { dir: string }) {
    const root = normDir(dir);
    const name = projectName(root);
    const files: Record<string, string> = {
      "package.json":
        JSON.stringify(
          {
            name: this.slug(name),
            version: "0.0.0",
            private: true,
            type: "module",
            scripts: { start: "node index.js" },
          },
          null,
          2,
        ) + "\n",
      "index.js": `console.log("Hello from ${name}!");\n`,
      "README.md": `# ${name}\n\nA blank project created in Vivari Studio.\n`,
    };
    const res = await this.bridge.request("vv-create-project", { dir: root, files, title: name });
    if (!res.ok) {
      toast.error(`Couldn't create project: ${res.error ?? "unknown error"}`);
      return;
    }
    this.upsertProjectMeta({ rootPath: root, template: null });
    this.openFolder(root);
    void this.openFile(root + "/index.js");
    this.status(`created ${name}`);
  }

  async createFromTemplate({
    templateId,
    dir,
    runInit,
  }: {
    templateId: string;
    dir: string;
    runInit: boolean;
  }) {
    const t = (await loadTemplates()).getTemplate(templateId);
    if (!t) {
      toast.error("Unknown template");
      return;
    }
    const root = normDir(dir);
    // One name, the folder's (D-035): the kernel is told where the project is, not a
    // display title the Explorer and the browser title would then have to reconcile.
    const title = projectName(root);
    // Mode C serves each port at its own origin root, so a keep-prefix template's
    // hardcoded `/preview/<port>/` base (built for modes A/B) would 404. Rewrite it
    // to "/" and drop the now-irrelevant flag so the app runs at the origin root.
    // Modes A/B keep the template verbatim.
    const wildcard = this.previewMode === "wildcard" && !!t.manifest.keepPreviewPrefix;
    const files = await withTemplateAssets(
      t,
      wildcard ? rewritePreviewBaseToRoot(t.files) : t.files,
    );
    const manifest = wildcard ? { ...t.manifest, keepPreviewPrefix: false } : t.manifest;
    const res = await this.bridge.request("vv-create-project", {
      dir: root,
      files,
      manifest,
      title,
    });
    if (!res.ok) {
      toast.error(`Couldn't create project: ${res.error ?? "unknown error"}`);
      return;
    }
    this.folderManifests.set(root, manifest);
    this.upsertProjectMeta({ rootPath: root, template: templateId });
    this.openFolder(root);
    void this.openFile(root + "/" + t.manifest.entry);
    if (runInit) {
      this.runProject(root);
    } else {
      this.status(`${title} created — run \`${t.manifest.install}\` then \`${t.manifest.dev}\``);
    }
  }

  // Open a previously-created project from the Home recent list.
  async openProject(meta: ProjectMeta) {
    // Before `kernel-online` the VFS worker has not even read the OPFS index, so the
    // project is genuinely not there *yet* — tell the user to retry rather than
    // calling it deleted (which would drop it from the recent list).
    if (!this.snap.kernelReady) {
      toast.info("Studio is still starting — please wait a moment, then try again.");
      return;
    }
    const root = normDir(meta.rootPath);
    const onDisk = await ensureProjectOnDisk(
      this.bridge,
      root,
      (p) => this.pathInfo(p),
      (line) => this.status(line),
    );
    if (!onDisk) {
      toast.error("This project's files are no longer on disk.");
      this.removeProjectMeta(root);
      return;
    }
    if (meta.template) {
      const t = (await loadTemplates()).getTemplate(meta.template);
      if (t) {
        this.folderManifests.set(root, t.manifest);
        this.bridge.post("vv-register-project", {
          dir: root,
          manifest: t.manifest,
          title: projectName(root),
        });
      }
    }
    this.touchProject(root);
    this.openFolder(root);
    const manifest = this.folderManifests.get(root);
    if (manifest) void this.openFile(root + "/" + manifest.entry);
    // node_modules is no longer mirrored file-by-file — it's restored from the
    // dependency-cache snapshot on demand. Bring it back now the project is open
    // (one blob read), then refresh the Explorer + IntelliSense to reflect it.
    void this.bridge.request("vv-ensure-deps", { dir: root }).then((res) => {
      if ((res as { restored?: boolean }).restored) {
        this.bumpTree();
        this.editorLanguage.scheduleDependencyTypes();
      }
    });
  }

  // Run a project: open a shell in its dir and auto-run install && dev. Re-uses
  // the existing run terminal if it's still alive.
  runProject(rootPath: string) {
    const root = normDir(rootPath);
    const manifest = this.folderManifests.get(root);
    this.set({ panelCollapsed: false });
    const running = this.runningProjects.get(root);
    if (running && running.terminalId && this.terminals.has(running.terminalId)) {
      this.terminals.switchTerminal(running.terminalId);
      if (running.port) this.preview.pointPreview(running.port);
      return;
    }
    if (!manifest) {
      // No known dev command — just drop the user into a shell in the project.
      this.openTerminalIn(root);
      return;
    }
    markBoot("install-start");
    warmRegistryConnection();
    const tid = this.terminals.newShellTerminal({
      cwd: root,
      run: manifest.dev,
      label: manifest.dev,
    });
    this.runningProjects.set(root, { terminalId: tid, port: null });
    this.beginRunPhase(root);
  }

  // ── run narration ──────────────────────────────────────────────────────────
  // A run's phase, kept in the snapshot so the preview panel and the status bar
  // say the same thing. `runTerminalId` is what ties terminal output back to the
  // run: the fetch counters arrive as bytes on a terminal, and every other
  // terminal's bytes must be ignored.
  private runTerminalId: string | null = null;

  private beginRunPhase(root: string) {
    const running = this.runningProjects.get(root);
    this.runTerminalId = running?.terminalId ?? null;
    this.editorLanguage.setIntelligence(false);
    const phase: RunPhase = {
      rootPath: root,
      name: this.snap.workspaceFolders.find((f) => f.rootPath === root)?.name || baseName(root),
      phase: "installing",
      detail: "",
      startedAt: Date.now(),
    };
    this.set({ runPhase: phase });
    this.status(`${phase.name}: installing dependencies…`);
  }

  private updateRunPhase(next: (cur: RunPhase) => RunPhase) {
    const cur = this.snap.runPhase;
    if (!cur) return;
    const updated = next(cur);
    if (updated !== cur) this.set({ runPhase: updated });
  }

  /** The run reached its end — a preview painted, or the run tab died. */
  private endRunPhase(root?: string) {
    if (!this.snap.runPhase) return;
    if (root && this.snap.runPhase.rootPath !== root) return;
    this.runTerminalId = null;
    this.set({ runPhase: null });
    this.editorLanguage.enableIntelligence();
    // node_modules exists now (or never will), so the types harvest is finally
    // able to find something.
    this.editorLanguage.scheduleDependencyTypes();
  }

  // Run the currently-focused folder (TitleBar / command palette Run).
  runActiveFolder() {
    const f = this.activeFolder;
    if (f) this.runProject(f.rootPath);
    else toast.error("Open a project first");
  }

  // Open a new terminal rooted at `absDir` (Explorer "Open in Integrated Terminal").
  openTerminalIn(absDir: string) {
    const dir = normDir(absDir);
    this.set({ panelCollapsed: false });
    this.terminals.newShellTerminal({ cwd: dir, label: baseName(dir) || "sh", activate: true });
  }

  goHome() {
    this.set({ view: "home" });
  }
  /** The boot pass that opens ?project= is over: drop the blocking overlay. */
  clearBootProject() {
    if (this.snap.bootProject !== null) this.set({ bootProject: null });
  }
  showWorkspace() {
    if (this.snap.workspaceFolders.length) this.set({ view: "workspace" });
  }

  // ── file operations (Explorer) — all absolute-path based ──────────────────
  private disposeModel(abs: string) {
    const model = this.models.get(abs);
    if (!model) return;
    if (this.editor && this.editor.getModel() === model) this.editor.setModel(null);
    model.dispose();
    this.models.delete(abs);
  }

  private bumpTree() {
    if (this.treeBump) clearTimeout(this.treeBump);
    this.treeBump = setTimeout(() => {
      this.treeBump = null;
      const root = this.activeFolder?.rootPath;
      if (root) void this.indexFolder(root);
      // Refresh Source Control status ONLY while its panel is open — a status walk
      // pushes many synchronous fs ops onto the kernel worker thread, which also
      // drives the terminal, so running it in the background would stall commands.
      // (git's own .git writes use the silent RPC and never reach here anyway.)
      if (this.snap.activeView === "scm") void this.scm.refresh();
      this.set({ treeVersion: this.snap.treeVersion + 1 });
    }, 60);
  }

  // Remap every open path that is `oldAbs` (or lives under it) onto `newAbs`.
  private remapOpenPaths(oldAbs: string, newAbs: string) {
    const map = (p: string) =>
      p === oldAbs ? newAbs : p.startsWith(oldAbs + "/") ? newAbs + p.slice(oldAbs.length) : p;
    const tabKinds = { ...this.snap.tabKinds };
    for (const abs of this.snap.openTabs) {
      if (abs === oldAbs || abs.startsWith(oldAbs + "/")) {
        const dest = map(abs);
        this.disposeModel(abs);
        if (abs in this.localFiles) {
          this.localFiles[dest] = this.localFiles[abs];
          delete this.localFiles[abs];
        }
        // Carry the render-kind + any image object URL over to the new path.
        if (abs in tabKinds) {
          tabKinds[dest] = tabKinds[abs];
          delete tabKinds[abs];
        }
        const url = this.imageUrls.get(abs);
        if (url) {
          this.imageUrls.set(dest, url);
          this.imageUrls.delete(abs);
        }
      }
    }
    this.set({
      openTabs: this.snap.openTabs.map(map),
      activeTab: this.snap.activeTab ? map(this.snap.activeTab) : null,
      tabKinds,
      previewTab: this.snap.previewTab ? map(this.snap.previewTab) : null,
      dirty: this.snap.dirty.map(map),
    });
    if (this.snap.activeTab)
      void this.openFile(this.snap.activeTab, {
        preview: this.snap.previewTab === this.snap.activeTab,
      });
  }

  private dropOpenPaths(abs: string) {
    const affected = new Set(
      this.snap.openTabs.filter((p) => p === abs || p.startsWith(abs + "/")),
    );
    const tabKinds = { ...this.snap.tabKinds };
    for (const p of affected) {
      this.disposeModel(p);
      delete this.localFiles[p];
      this.revokeImage(p);
      delete tabKinds[p];
    }
    const openTabs = this.snap.openTabs.filter((p) => !affected.has(p));
    let activeTab = this.snap.activeTab;
    if (activeTab && affected.has(activeTab)) activeTab = openTabs[openTabs.length - 1] ?? null;
    this.set({
      openTabs,
      activeTab,
      tabKinds,
      previewTab:
        this.snap.previewTab && affected.has(this.snap.previewTab) ? null : this.snap.previewTab,
      dirty: this.snap.dirty.filter((p) => !affected.has(p)),
    });
    if (activeTab) void this.openFile(activeTab);
    else this.editor?.setModel(null);
  }

  copyEntry(abs: string) {
    this.copyEntries([abs]);
  }
  cutEntry(abs: string) {
    this.cutEntries([abs]);
  }
  copyEntries(paths: string[]) {
    if (paths.length) this.set({ clipboard: { mode: "copy", paths: [...paths] } });
  }
  cutEntries(paths: string[]) {
    if (paths.length) this.set({ clipboard: { mode: "cut", paths: [...paths] } });
  }

  renameEntry(oldAbs: string, newName: string) {
    const name = newName.trim();
    if (!name || name === baseName(oldAbs)) return;
    const parent = oldAbs.slice(0, oldAbs.lastIndexOf("/"));
    const newAbs = parent + "/" + name;
    this.bridge.post("vv-rename", { from: oldAbs, to: newAbs });
    this.remapOpenPaths(oldAbs, newAbs);
    if (this.snap.clipboard?.paths.includes(oldAbs)) this.set({ clipboard: null });
    this.bumpTree();
  }

  deleteEntry(abs: string) {
    this.deleteEntries([abs]);
  }
  // Delete every entry in `paths` (batch delete from a multi-selection).
  deleteEntries(paths: string[]) {
    if (!paths.length) return;
    for (const abs of paths) {
      this.bridge.post("vv-rm", { path: abs });
      this.dropOpenPaths(abs);
    }
    const cb = this.snap.clipboard;
    if (cb) {
      const remaining = cb.paths.filter((p) => !paths.includes(p));
      if (remaining.length !== cb.paths.length) {
        this.set({ clipboard: remaining.length ? { ...cb, paths: remaining } : null });
      }
    }
    this.bumpTree();
  }

  // Paste every clipboard entry into `destDirAbs`.
  async pasteInto(destDirAbs: string) {
    const cb = this.snap.clipboard;
    if (!cb) return;
    const dest = normDir(destDirAbs);
    for (const src of cb.paths) {
      // Cutting into itself/descendant/current parent is a no-op — skip.
      if (
        cb.mode === "cut" &&
        (dest === src || dest.startsWith(src + "/") || dest === parentOf(src))
      )
        continue;
      const target = await this.uniqueChild(dest, baseName(src));
      if (cb.mode === "copy") {
        this.bridge.post("vv-copy", { from: src, to: target });
      } else {
        this.bridge.post("vv-rename", { from: src, to: target });
        this.remapOpenPaths(src, target);
      }
    }
    if (cb.mode === "cut") this.set({ clipboard: null });
    this.bumpTree();
  }

  // ── drag & drop (Explorer reorg + OS import + open-in-editor) ──────────────
  // Compute a non-colliding child path in `destDir` for `name`, appending
  // -copy, -copy-2, … (matches pasteInto's clobber-avoidance).
  private async uniqueChild(destDir: string, name: string): Promise<string> {
    const target = destDir + "/" + name;
    if (!(await this.pathInfo(target)).exists) return target;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; ; n++) {
      const cand = `${destDir}/${stem}-copy${n > 1 ? `-${n}` : ""}${ext}`;
      if (!(await this.pathInfo(cand)).exists) return cand;
    }
  }

  // Move an entry into `destDirAbs` (default Explorer drag). No-ops for a drop
  // into the current parent or a folder dropped into itself/a descendant.
  async moveEntry(fromAbs: string, destDirAbs: string) {
    const from = fromAbs.replace(/\/+$/, "");
    const dest = normDir(destDirAbs);
    if (dest === parentOf(from)) return;
    if (dest === from || dest.startsWith(from + "/")) return;
    const target = await this.uniqueChild(dest, baseName(from));
    this.bridge.post("vv-rename", { from, to: target });
    this.remapOpenPaths(from, target);
    if (this.snap.clipboard?.paths.includes(from)) this.set({ clipboard: null });
    this.bumpTree();
  }

  // Copy an entry into `destDirAbs` (Ctrl/Cmd-drag). A folder can't be copied
  // into itself or a descendant.
  async copyEntryTo(fromAbs: string, destDirAbs: string) {
    const from = fromAbs.replace(/\/+$/, "");
    const dest = normDir(destDirAbs);
    if (dest === from || dest.startsWith(from + "/")) return;
    const target = await this.uniqueChild(dest, baseName(from));
    this.bridge.post("vv-copy", { from, to: target });
    this.bumpTree();
  }

  // Batch move/copy for a multi-selection drag. Sequential so per-item
  // collision suffixes (-copy, -copy-2, …) resolve against prior writes.
  async moveEntries(paths: string[], destDirAbs: string) {
    for (const p of paths) await this.moveEntry(p, destDirAbs);
  }
  async copyEntriesTo(paths: string[], destDirAbs: string) {
    for (const p of paths) await this.copyEntryTo(p, destDirAbs);
  }

  // Import OS files/folders (dragged from the desktop) into `destDirAbs`.
  // `entries` come from entriesFromDataTransfer (extracted synchronously in the
  // drop handler). Returns the created top-level target paths.
  async importInto(destDirAbs: string, entries: FileSystemEntry[]): Promise<string[]> {
    const dest = normDir(destDirAbs);
    const targets: string[] = [];
    let count = 0;
    for (const entry of entries) {
      const target = await this.uniqueChild(dest, entry.name);
      count += await this.writeEntry(entry, target);
      targets.push(target);
    }
    if (count) {
      this.bumpTree();
      this.status(`imported ${count} file${count === 1 ? "" : "s"} into ${baseName(dest) || "/"}`);
    }
    return targets;
  }

  // Recursively write one OS FileSystemEntry to `targetAbs` in the VFS. Returns
  // the number of files written.
  private async writeEntry(entry: FileSystemEntry, targetAbs: string): Promise<number> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.bridge.request("vv-write", { path: targetAbs, bytes });
      return 1;
    }
    if (entry.isDirectory) {
      await this.bridge.request("vv-mkdirp", { path: targetAbs });
      const children = await readDirEntries(entry as FileSystemDirectoryEntry);
      let n = 0;
      for (const child of children) n += await this.writeEntry(child, targetAbs + "/" + child.name);
      return n;
    }
    return 0;
  }

  // A drop landed on the Monaco editor. Internal entries open directly; OS
  // files are imported into the active folder's root, then opened.
  async dropOnEditor({ paths, entries }: { paths: string[]; entries: FileSystemEntry[] }) {
    if (paths.length) {
      for (const p of paths) void this.openEntry(p);
      return;
    }
    if (!entries.length) return;
    const root = this.activeFolder?.rootPath;
    if (!root) {
      toast.error("Open a project first to view dropped files");
      return;
    }
    const targets = await this.importInto(root, entries);
    if (targets[0]) void this.openEntry(targets[0]);
  }

  // ── import / export / share (P2) ────────────────────────────────────────────
  // The implementations live in project-export.ts / project-import.ts; these
  // methods stay as the component-facing API (Home, Explorer, palette, dialog).
  exportProjectZip(rootPath: string) {
    return this.projectExport.exportProjectZip(rootPath);
  }
  shareProject(rootPath: string) {
    return this.projectExport.shareProject(rootPath);
  }
  importFolderViaPicker() {
    this.projectImport.importFolderViaPicker();
  }
  importDropAsProject(entries: FileSystemEntry[]) {
    return this.projectImport.importDropAsProject(entries);
  }
  openImportRemote() {
    this.projectImport.openImportRemote();
  }
  closeImportRemote() {
    this.projectImport.closeImportRemote();
  }
  importGithubRepo(input: string, onProgress?: ProgressFn) {
    return this.projectImport.importGithubRepo(input, onProgress);
  }
  importNpmPackage(input: string, onProgress?: ProgressFn) {
    return this.projectImport.importNpmPackage(input, onProgress);
  }

  // Command-palette convenience: export / share the active workspace folder.
  exportActiveFolder() {
    const root = this.activeFolder?.rootPath;
    if (!root) {
      toast.error("Open a project first.");
      return;
    }
    void this.projectExport.exportProjectZip(root);
  }
  shareActiveFolder() {
    const root = this.activeFolder?.rootPath;
    if (!root) {
      toast.error("Open a project first.");
      return;
    }
    void this.projectExport.shareProject(root);
  }

  // On boot, if the URL carries a #share= payload, decode it into a new project
  // and open it. Clears the hash afterward so a reload doesn't re-import.
  private async loadSharedFromUrl() {
    const marker = "#share=";
    const hash = location.hash || "";
    const idx = hash.indexOf(marker);
    if (idx < 0) return;
    const payload = hash.slice(idx + marker.length);
    if (!payload) {
      this.set({ shareLoading: false });
      return;
    }
    history.replaceState(null, "", location.pathname + location.search);
    try {
      this.set({ shareLoading: true, shareMessage: "Unpacking files…" });
      const { ok, dir, files } = await this.projectImport.importShared(payload);
      if (ok) {
        const projName = projectName(dir);
        toast.success(`Opened shared project “${projName}”`, {
          position: "bottom-left",
          description: `${files} file${files === 1 ? "" : "s"} · source only · Run to install deps.`,
        });
      } else if (!this.snap.workspaceFolders.length) {
        this.goHome();
      }
    } catch (err) {
      toast.error("Couldn't open shared project: " + errText(err), { position: "bottom-left" });
      if (!this.snap.workspaceFolders.length) this.goHome();
    } finally {
      this.set({ shareLoading: false });
    }
  }
  async newFile(destDirAbs: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    const abs = normDir(destDirAbs) + "/" + clean;
    if ((await this.pathInfo(abs)).exists) {
      toast.error(`"${clean}" already exists`);
      return;
    }
    await this.bridge.request("vv-write", { path: abs, contents: "" });
    this.bumpTree();
    void this.openFile(abs);
  }
  async newFolder(destDirAbs: string, name: string) {
    const clean = name.trim();
    if (!clean) return;
    const abs = normDir(destDirAbs) + "/" + clean;
    if ((await this.pathInfo(abs)).exists) {
      toast.error(`"${clean}" already exists`);
      return;
    }
    await this.bridge.request("vv-mkdirp", { path: abs });
    this.bumpTree();
  }

  copyPath(abs: string) {
    try {
      void navigator.clipboard?.writeText(abs);
      this.status(`copied path: ${abs}`);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }

  // ── demo run (legacy built-in examples) ────────────────────────────────────
  setSelectedDemo(id: string) {
    this.set({ selectedDemo: id });
  }
  runDemo() {
    const demo = this.snap.selectedDemo;
    this.set({ panelCollapsed: false, view: "workspace" });
    const running = this.runningDemos.get(demo);
    if (running && running.terminalId && this.terminals.has(running.terminalId)) {
      this.terminals.switchTerminal(running.terminalId);
      if (running.port) this.preview.pointPreview(running.port);
      return;
    }
    const opt = DEMOS.find((d) => d.id === demo);
    const tid = this.terminals.newShellTerminal({ demo, label: opt?.runLabel ?? "run" });
    this.runningDemos.set(demo, { terminalId: tid, port: null });
    this.status("installing from npm + booting in-VM…");
  }

  // ── UI toggles ──
  togglePanel(force?: boolean) {
    const collapsed = force === undefined ? !this.snap.panelCollapsed : !force;
    this.set({ panelCollapsed: collapsed });
    if (!collapsed) this.terminals.setPanelTab(this.snap.panelTab);
  }
  toggleSidebar(force?: boolean) {
    const collapsed = force === undefined ? !this.snap.sidebarCollapsed : !force;
    this.set({ sidebarCollapsed: collapsed });
  }
  togglePreview(force?: boolean) {
    const collapsed = force === undefined ? !this.snap.previewCollapsed : !force;
    this.set({ previewCollapsed: collapsed });
  }
  /** Soft-wrap long lines, VS Code's Alt+Z. Applied to both editors and persisted. */
  toggleWordWrap(force?: boolean) {
    const on = force === undefined ? !this.snap.wordWrap : force;
    if (on === this.snap.wordWrap) return;
    this.set({ wordWrap: on });
    saveWordWrap(on);
    // updateOptions on the LIVE editors, because the option is per-editor and neither
    // one is remounted by a snapshot change. Both may be absent — the text editor
    // before Monaco has loaded, the diff editor whenever no diff tab is open.
    const wordWrap = on ? ("on" as const) : ("off" as const);
    this.editor?.updateOptions({ wordWrap });
    this.diffEditor?.updateOptions({ wordWrap });
  }
  openPalette(mode: "command" | "file") {
    this.set({ paletteOpen: true, paletteMode: mode });
  }
  closePalette() {
    this.set({ paletteOpen: false });
  }
  // Force a clean slate, then reload: VFS mirror + dependency cache, Service Worker
  // registrations and CacheStorage (resetOriginState — "clear cached files" leaves the
  // worker registered). The FS worker holds OPFS sync-access handles, so we tear the
  // worker down FIRST (releasing them) — removeEntry() would otherwise throw.
  async resetEverything() {
    try {
      this.bridge.destroy();
    } catch {
      /* worker already gone */
    }
    // Wipe the recent-projects registry too, so "reset everything" truly starts
    // from a clean slate (the Home screen's Recent list is backed by this key).
    try {
      localStorage.removeItem(PROJECTS_KEY);
      this.set({ recentProjects: [] });
    } catch {
      /* storage disabled — nothing to clear */
    }
    try {
      await resetOriginState();
    } catch {
      /* OPFS unavailable / nothing persisted — reload into a fresh session anyway */
    }
    location.reload();
  }

  // ── memory diagnostics ─────────────────────────────────────────────────────
  // The breakdown itself lives in memory-probe.ts; this file is ratchet-pinned.
  async measureMemory() {
    this.set({
      memInfo: await probeMemory(this.bridge, (text, color) => this.consoleLine(text, color)),
    });
  }

  /**
   * The runtime died on the way up. First cause wins — a kernel worker that never
   * evaluated produces follow-on failures, and the first one is the one that
   * names the real problem. Clears the boot progress state so Home stops
   * advertising progress that is never going to arrive.
   */
  private failBoot(message: string) {
    if (this.snap.bootError) return;
    this.consoleLine(message, "31");
    this.set({ bootError: message, bootPhase: "", shareLoading: false });
    toast.error("The Vivari runtime failed to start", {
      description: message,
      duration: Infinity,
    });
  }

  // ── kernel worker message handling (ported from host.js) ──────────────────
  private wireBridge() {
    const b = this.bridge;
    b.on("stdout", (m) => this.consoleWrite(m.chunk as string));
    b.on("stderr", (m) => this.consoleWrite(m.chunk as string));
    b.on("log", (m) => {
      const stderr = m.stream === "stderr";
      const dim = (m.dim as boolean) || m.cls === "muted";
      const line = m.line as string;
      // A snapshot restore and a cold install look the same from the outside and
      // take wildly different amounts of time; say which one is happening — and
      // stop saying "restoring" the moment the restore gives up, since what
      // follows is the long path, not the short one.
      // Give-up first: its error text can quote a message containing "fetching",
      // and the outcome is the less ambiguous signal of the two.
      if (isInstallFallbackLine(line)) this.updateRunPhase(fallBackToInstall);
      else if (isRestoreLine(line)) this.updateRunPhase((cur) => advance(cur, "restoring"));
      this.consoleLine(line, stderr ? "31" : dim ? "90" : undefined);
    });
    // Cold-boot progress (relayed from the FS worker's OPFS restore + kernel
    // phase markers). Drives the Home boot indicator until `kernelReady`.
    b.on("boot-progress", (m) => {
      // Phase changes only. `restore` fires once per entry re-hydrated, which for
      // a real project is thousands of events — tracing each would evict the whole
      // boot narration under TRACE_CAP and tell us nothing the phase didn't.
      const phase = (m.phase as string) || "";
      this.set({
        bootPhase: phase,
        bootDone: (m.done as number) ?? 0,
        bootTotal: (m.total as number) ?? 0,
      });
    });
    // The kernel + VFS are up (before the PM tarballs finish loading) — the Home
    // screen can create/open projects now, so don't make the user wait for `ready`.
    b.on("kernel-online", () => {
      markBoot("kernel-online");
      this.set({ kernelReady: true, bootPhase: "" });
      // Only now: the kernel worker has loaded and evaluated, so the SW activating
      // and claiming the page can no longer interrupt it. A preview cannot exist
      // before this point either, so nothing is lost by waiting. If the runtime
      // never comes up we never register — which is correct, because a preview
      // proxy with no runtime to proxy to has nothing to do.
      void this.bridge.registerServiceWorker().then(
        (ok) => {
          this.consoleLine(
            ok
              ? "Service Worker registered (preview proxy ready)."
              : "Service workers unavailable — preview disabled.",
            ok ? "32" : "31",
          );
        },
        (err) => {
          this.consoleLine(
            `Service Worker registration failed: ${String(err)} — preview disabled.`,
            "31",
          );
        },
      );
    });
    // The two ways the runtime can die before `kernel-online`, neither of which
    // had a listener here. Both used to leave Home spinning on "Starting runtime…"
    // indefinitely, which is indistinguishable from a slow restore and gives the
    // user nothing to report.
    //
    //   `error` (fatal) — the kernel worker ran and boot() threw; the worker posts
    //                     this from boot().catch, and it carries a real message.
    //   onWorkerError   — the kernel worker never got that far: its module graph
    //                     failed to load or evaluate, so it can never post
    //                     anything. Only the bridge's `onerror` hook sees it.
    b.on("error", (m) => {
      if (!m.fatal) return;
      this.failBoot(String(m.message ?? "the runtime stopped during start-up"));
    });
    this.bridge.onWorkerError((message) => {
      // The same test spawnWorker makes for process workers: a kernel worker that
      // has already brought the runtime online plainly evaluated its module graph,
      // so a later `error` from it is an uncaught exception — which per spec is
      // reported without killing the worker — and not a failure to start. Say so
      // rather than declaring a live runtime dead.
      if (this.snap.kernelReady) {
        this.consoleLine(`[kernel] uncaught worker error: ${message}`, "31");
        return;
      }
      this.failBoot(`the kernel worker could not start: ${message}`);
    });
    b.on("ready", () => {
      markBoot("kernel-ready");
      this.consoleLine("Kernel ready.", "32");
      this.set({ booted: true, kernelReady: true });
      this.status("ready — create or open a project");
      this.terminals.newShellTerminal({ defer: true, activate: false });
      // If the URL carries a #share= payload, import it into a new project.
      void this.loadSharedFromUrl();
    });
    b.on("exit", (m) => {
      this.consoleLine(`[kernel] pid ${m.pid} exited with code ${m.code}`, "90");
      // A listener process died — drop any port it owned from the Ports view.
      const pid = m.pid as number;
      let changed = false;
      for (const [port, owner] of this.portMap) {
        if (owner === pid) {
          this.portMap.delete(port);
          changed = true;
        }
      }
      if (changed) this.syncPorts();
      // A process finished — it may have been `npm/yarn/pnpm install`. In-VM writes
      // don't emit vv-fs-changed, so re-harvest dependency types (debounced; the
      // worker short-circuits via a node_modules fingerprint when nothing changed).
      this.editorLanguage.scheduleDependencyTypes();
    });
    b.on("listen", (m) => {
      this.consoleLine(`[kernel] pid ${m.pid} listening on :${m.port}`, "90");
      this.portMap.set(m.port as number, m.pid as number);
      this.syncPorts();
      this.updateRunPhase((cur) => advance(cur, "starting"));
    });

    // interactive terminals
    b.on("term-ready", (m) => {
      const id = m.terminalId as string;
      const nb = this.notebookTerminal(id);
      if (nb) {
        nb.kernel.onTerminalReady();
        return;
      }
      this.terminals.onProcessReady(id, m.pid as number, (terminalId, chunk) => {
        b.post("term-input", { terminalId, chunk });
      });
    });
    b.on("term-out", (m) => {
      // A notebook kernel's terminal has no xterm: its stdout is the protocol,
      // and the frames are pulled out of it by the session's FrameReader.
      const nb = this.notebookTerminal(m.terminalId as string);
      if (nb) {
        nb.kernel.handleOutput(m.chunk as string);
        return;
      }
      const chunk = m.chunk as string;
      const bootMs = this.terminals.writeTo(m.terminalId as string, chunk);
      if (bootMs) {
        this.consoleLine(`[boot] shell (Process Worker) booted in ${Math.round(bootMs)}ms`, "90");
      }
      if (m.terminalId === this.runTerminalId) {
        const p = readFetchProgress(chunk);
        if (p) this.updateRunPhase((cur) => ({ ...cur, detail: formatProgress(p) }));
      }
    });
    b.on("term-exit", (m) => {
      const id = m.terminalId as string;
      const nb = this.notebookTerminal(id);
      if (nb) {
        nb.kernel.handleExit(m.code as number);
        return;
      }
      const exited = this.terminals.markExited(id, Number(m.code));
      if (!exited) return;
      // A demo's dev-server tab ended → server gone.
      if (exited.demo && this.runningDemos.get(exited.demo)?.terminalId === id) {
        const gone = this.runningDemos.get(exited.demo);
        this.runningDemos.delete(exited.demo);
        if (gone?.port != null && this.portMap.delete(gone.port)) this.syncPorts();
        if (gone?.port != null && this.snap.previewTabs.some((t) => t.port === gone.port))
          this.status("dev server stopped — preview will 502 until you Run again");
      }
      // A created/opened project's run tab ended → server gone.
      for (const [dir, r] of this.runningProjects) {
        if (r.terminalId === id) {
          this.runningProjects.delete(dir);
          if (r.port != null && this.portMap.delete(r.port)) this.syncPorts();
          this.preview.syncKeepPrefixPorts();
          // The run is over however it ended. An install that FAILED must stop
          // claiming to be installing — the preview shell would otherwise sit
          // there indefinitely while the answer is already in the terminal.
          this.endRunPhase(dir);
          if (r.port != null && this.snap.previewTabs.some((t) => t.port === r.port))
            this.status("dev server stopped — preview will 502 until you Run again");
        }
      }
      this.terminals.sync();
    });

    // HMR tunnel: ws frame routed OUT of the VM → preview iframes. The frame
    // doesn't carry a port, so deliver to every tab bound to a dev server; the
    // HMR client in each iframe ignores frames that aren't its own.
    b.on("vv-ws", (m) => {
      const payload = { ...(m.msg as object), type: "vv-ws", dir: "in" };
      this.preview.relayFrame(payload);
    });

    // SSE tunnel: a text/event-stream chunk routed OUT of the VM → preview iframes.
    // Like the ws frame it doesn't carry a port, so deliver to every bound tab; the
    // iframe's EventSource polyfill ignores chunks for connIds it doesn't own.
    b.on("vv-sse", (m) => {
      const payload = { ...(m.msg as object), type: "vv-sse", dir: "in" };
      this.preview.relayFrame(payload);
    });

    // Legacy built-in demo became ready.
    b.on("demo-ready", (m) => {
      this.preview.pointPreview(m.port as number);
      const r = this.runningDemos.get(m.id as string);
      if (r) r.port = m.port as number;
      else this.runningDemos.set(m.id as string, { terminalId: null, port: m.port as number });
      const dir = m.dir as string;
      const runLabel = DEMOS.find((d) => d.id === m.id)?.runLabel ?? "npm run dev";
      this.folderManifests.set(normDir(dir), {
        id: m.id as string,
        framework: "react",
        name: m.title as string,
        language: "JavaScript",
        icon: "react",
        category: "Frontend",
        description: "",
        port: m.port as number,
        openPath: "/",
        entry: m.entry as string,
        hmr: !!m.hmr,
        reload: !!m.reload,
        install: "npm install",
        dev: runLabel,
      });
      this.openFolder(dir);
      if (m.entry) void this.openFile(dir + "/" + (m.entry as string));
      this.status(
        m.reload
          ? `${m.title} running — edits recompile + restart`
          : `${m.title} running — edits hot-reload`,
      );
    });
    b.on("demo-reload", (m) => {
      this.preview.reloadPort(m.port as number);
      this.status(`${m.title} restarted — preview reloaded`);
    });
    b.on("demo-status", (m) => this.status(m.line as string));

    // A created/opened project's dev server is up.
    b.on("project-ready", (m) => {
      const dir = normDir(m.dir as string);
      // An EXTRA service of a multi-server project (e.g. a backend/ws server
      // alongside the frontend): just add its preview tab — the primary already
      // opened the folder + entry file.
      if (m.extra) {
        this.preview.pointPreview(m.port as number);
        this.status(`${m.title as string}: service on :${m.port} ready`);
        return;
      }
      const r = this.runningProjects.get(dir);
      if (r) r.port = m.port as number;
      else this.runningProjects.set(dir, { terminalId: null, port: m.port as number });
      // Tell the SW whether this port serves under the /preview/<port>/ prefix
      // (keep-prefix templates like Docusaurus) BEFORE the iframe loads, so a
      // client-routed SPA resolves its first route instead of hitting NotFound.
      // A replaced project's dev server can become ready after this tab moved on to
      // another project (D-035); it must not steal the preview or an editor tab back.
      const owned = this.snap.workspaceFolders.some((f) => f.rootPath === dir);
      if (!owned && this.snap.workspaceFolders.length) return;
      this.preview.syncKeepPrefixPorts();
      this.preview.pointPreview(m.port as number);
      if (!owned) this.openFolder(dir);
      if (m.entry) void this.openFile(dir + "/" + (m.entry as string));
      this.touchProject(dir);
      this.status(
        m.reload
          ? `${m.title} running — edits recompile + restart`
          : `${m.title} running — edits hot-reload`,
      );
    });
    b.on("project-reload", (m) => {
      this.preview.reloadPort(m.port as number);
      this.status(`${m.title} restarted — preview reloaded`);
    });

    // Streaming full-text search: batches of per-file results, then a final done.
    b.on("vv-search-result", (m) => this.search.onResult(m));
    b.on("vv-search-done", (m) => this.search.onDone(m));

    // The VFS changed under us (a file op, an install, a create) — refresh the
    // Explorer's live tree + re-index the active folder for quick-open/search.
    b.on("vv-fs-changed", () => this.bumpTree());

    // Result of an Explorer file operation (rename/rm/copy). The UI already updated
    // optimistically; surface any failure so the user knows the VFS is out of sync.
    b.on("vv-fs-result", (m) => {
      if (!m.ok) toast.error(`${m.op} failed: ${m.error ?? "unknown error"}`);
    });
  }
}
