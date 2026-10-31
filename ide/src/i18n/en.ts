// The IDE's English catalogue.
//
// Flat keys (O-001, the same convention as the framework's locales/en.json):
// every user-facing string in the IDE goes through t() and lives here — never in
// JSX. `{placeholder}` values interpolate; `it.ts` mirrors this file and may be
// partial (a missing translation falls back to English key by key).
//
// Not yet migrated: the upstream-inherited editor chrome (Explorer, Search, Debug,
// SCM, Notebook, EditorGroup, Home, TitleBar, StatusBar, Preview and Terminal
// panels). Those move here file by file as they are touched — see ide/I18N.md.
export const en = {
  // ── shared ───────────────────────────────────────────────────────────────
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.remove": "Remove",

  // ── theme (command palette) ──────────────────────────────────────────────
  "theme.light": "Theme: Light",
  "theme.dark": "Theme: Dark",
  "theme.system": "Theme: System",

  // ── Home: recent projects ────────────────────────────────────────────────
  "recent.blank": "blank",
  "recent.justNow": "just now",
  "recent.minutesAgo": "{n}m ago",
  "recent.hoursAgo": "{n}h ago",
  "recent.daysAgo": "{n}d ago",
  "recent.openInNewTab": "Open in a new tab",
  "recent.openInNewTabAria": "Open {name} in a new tab",
  "recent.removeFromList": "Remove from list",

  // ── Import from GitHub / npm ─────────────────────────────────────────────
  "import.title": "Import from GitHub or npm",
  "import.description":
    "Fetch a public repo or an npm package as a new project. Downloaded in your browser — no server involved.",
  "import.github": "GitHub",
  "import.npm": "npm",
  "import.repository": "Repository",
  "import.package": "Package",
  "import.githubPlaceholder": "owner/repo, owner/repo@branch, or a github.com URL",
  "import.npmPlaceholder": "left-pad, react@18, or @scope/pkg@1.2.3",
  "import.githubHint": "Public repositories only. Default branch unless a ref is given.",
  "import.npmHint": "Unpacks the published tarball (the package contents, not its deps).",
  "import.starting": "Starting…",
  "import.submit": "Import",
  "import.progress": "{phase} ({done}/{total})",

  // ── command palette ──────────────────────────────────────────────────────
  "palette.commandPlaceholder": "Type a command…",
  "palette.filePlaceholder": "Search files by name (append :line to jump)…",
  "palette.commands": "Commands",
  "palette.noResults": "No results.",
  "palette.currentFile": "Current File",
  "palette.files": "Files",
  "palette.filesLine": "Files · line {line}",
  "palette.goToLine": "Go to line {line}",
  "palette.home": "Go Home / New Project",
  "palette.newTerminal": "New Terminal",
  "palette.runProject": "Run Project",
  "palette.importFolder": "Import Folder as Project",
  "palette.importRemote": "Import from GitHub or npm",
  "palette.exportZip": "Export Project as Zip",
  "palette.shareProject": "Share Project (copy link)",
  "palette.toggleTerminal": "Toggle Terminal Panel",
  "palette.toggleSidebar": "Toggle Sidebar",
  "palette.togglePreview": "Toggle Preview Panel",
  "palette.toggleWordWrap": "Toggle Word Wrap",
  "palette.clearTerminal": "Clear Active Terminal",
  "palette.reloadPreview": "Reload Preview",
  "palette.measureMemory": "Measure Memory",
  "palette.resetEverything": "Reset Everything (wipe files + caches)",
  "palette.resetConfirm":
    "Reset everything? This permanently deletes all saved files and cached dependencies, then reloads.",
} as const;
