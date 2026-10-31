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

  // ── activity bar (view labels + tooltips) ────────────────────────────────
  "activity.workspace": "Workspace",
  "activity.search": "Search",
  "activity.scm": "Source Control",
  "activity.debug": "Run and Debug",
  "activity.chat": "AI Chat",
  "activity.theme": "Theme",

  // ── theme (command palette) ──────────────────────────────────────────────
  "theme.light": "Theme: Light",
  "theme.dark": "Theme: Dark",
  "theme.system": "Theme: System",
  "theme.option.system": "Follow system",
  "theme.option.light": "Light",
  "theme.option.dark": "Dark",

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
  "palette.openChat": "Open AI Chat",
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

  // ── AI chat (D-045) ──────────────────────────────────────────────────────
  "chat.title": "AI Chat",
  "chat.newChat": "New chat",
  "chat.settings": "Chat settings",
  "chat.placeholder": "Describe a change…",
  "chat.send": "Send",
  "chat.stop": "Stop",
  "chat.thinking": "Thinking…",
  "chat.applying": "Applying…",
  "chat.footer": "AI can make mistakes — review every patch before applying.",
  "chat.configured": "{provider} · {model}",
  "chat.empty.title": "Build with the assistant",
  "chat.empty.body":
    "Describe a change in plain language. The assistant proposes a patch; nothing is written until you review and apply it.",
  "chat.empty.configure": "Configure a provider",
  "chat.empty.noProject": "Open a project to use the assistant",
  "chat.empty.noProjectBody":
    "The assistant reads the project's manifest, file list and open file before answering.",
  "chat.empty.privacy":
    "Your key stays in this browser and is sent only to the provider you choose.",
  "chat.error.title": "The assistant could not answer",
  "chat.error.aborted": "Stopped.",
  "chat.error.network":
    "Network error — the provider may refuse direct browser requests (CORS). Check the key and the endpoint.",
  "chat.error.http": "The provider refused the request: {status}",
  "chat.error.stream": "The response stream broke.",
  "chat.error.empty": "The provider returned an empty answer.",
  "chat.error.unsupported": "This provider is not available in this build.",
  "chat.parse.error": "The answer was not a usable AIResponse.",
  "chat.detail": "Details",
  "chat.proposal.title": "Proposed changes",
  "chat.proposal.apply": "Apply {n}",
  "chat.proposal.applyAll": "Apply all",
  "chat.proposal.discard": "Discard",
  "chat.proposal.showDiff": "Show diff",
  "chat.proposal.hideDiff": "Hide diff",
  "chat.proposal.notes": "Notes",
  "chat.proposal.confirm": "This patch changes the database schema and needs confirmation.",
  "chat.proposal.applied": "Applied {n} file(s)",
  "chat.proposal.failed": "Applied with errors",
  "chat.proposal.undo": "Undo applied changes",
  "chat.proposal.undoing": "Reverting…",
  "chat.proposal.reverted": "Reverted {n} file(s)",
  "chat.proposal.revertedFailed": "Revert failed",
  "chat.proposal.warnings": "Review warnings",
  "chat.warning.nodeGlobal":
    "{symbol} does not exist in the browser — use import.meta.env or a server route.",
  "chat.warning.serverImport": "Server-only module imported into browser code: {symbol}.",
  "chat.proposal.openFile": "Open {path}",
  "chat.proposal.noChanges": "No changes proposed.",
  "chat.settings.title": "AI provider",
  "chat.settings.description":
    "Bring your own key. It is stored in this browser and sent only to the provider.",
  "chat.settings.provider": "Provider",
  "chat.settings.apiKey": "API key",
  "chat.settings.apiKeyPlaceholder": "sk-…",
  "chat.settings.model": "Model",
  "chat.settings.baseUrl": "Base URL",
  "chat.settings.baseUrlPlaceholder": "https://host/v1",
  "chat.settings.save": "Save",
  "chat.settings.clear": "Remove key",
  "chat.settings.mockNote":
    "Dev-only: answers with a canned patch so the flow can be tested without a key.",
  "chat.settings.errorProvider": "Choose a provider.",
  "chat.settings.errorModel": "Enter a model.",
  "chat.settings.errorKey": "Enter an API key.",
  "chat.settings.errorBaseUrl": "Enter the endpoint's base URL.",
  "chat.context": "{manifest} · {files} file(s)",
  "chat.context.manifest": "manifest {revision}",
  "chat.context.noManifest": "manifest unreachable",
  "chat.provider.anthropic": "Anthropic",
  "chat.provider.openai": "OpenAI",
  "chat.provider.openrouter": "OpenRouter",
  "chat.provider.deepseek": "DeepSeek",
  "chat.provider.custom": "Custom (OpenAI-compatible)",
  "chat.provider.mock": "Mock (dev)",
  "chat.keyHint.anthropic": "Create a key at console.anthropic.com → API keys.",
  "chat.keyHint.openai": "Create a key at platform.openai.com → API keys.",
  "chat.keyHint.openrouter": "Create a key at openrouter.ai/keys.",
  "chat.keyHint.deepseek": "Create a key at platform.deepseek.com → API keys.",
  "chat.keyHint.custom": "Any OpenAI-compatible endpoint. A local server needs no key.",
  "chat.keyHint.mock": "Built into dev builds; never calls a provider.",
} as const;
