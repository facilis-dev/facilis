// The IDE's English catalogue.
//
// Flat keys (O-001, the same convention as the framework's locales/en.json):
// every user-facing string in the IDE goes through t() and lives here — never in
// JSX. `{placeholder}` values interpolate; `it.ts` mirrors this file and may be
// partial (a missing translation falls back to English key by key).
//
// Not yet migrated: the upstream-inherited editor chrome (Explorer, Search, Debug,
// SCM, Notebook, EditorGroup, TitleBar, StatusBar, Preview and Terminal panels).
// Those move here file by file as they are touched — see ide/I18N.md.
import { gitRemoteEn } from "./en-git-remote";
export const en = {
  // ── product ──────────────────────────────────────────────────────────────
  // The brand is a message like any other: the fork shows facilis.dev (the visible
  // title is the logo), and the upstream name survives only in attribution, package
  // ids and the `__vv*` internals (D-069).
  "app.name": "facilis.dev",

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

  // ── bootstrap ────────────────────────────────────────────────────────────
  "boot.starting": "Starting runtime",
  "boot.restoring": "Restoring your saved project",
  "boot.finalizing": "Finalizing runtime",
  "boot.settingUp":
    "Setting up the in-browser runtime — import and project actions unlock in a moment.",
  "boot.progress": "{done} / {total} ({pct}%)",
  "boot.failed": "The runtime failed to start",
  "boot.failedHint":
    "Reloading the page usually clears it. If it keeps happening, the browser console has the underlying error.",
  "boot.reload": "Reload",
  "boot.openingTitle": "Opening {name}",
  "boot.openingHint": "Restoring its files and starting the runtime.",

  // ── projects ─────────────────────────────────────────────────────────────
  "project.missing": "This tab's project is not in the recent-projects list any more.",
  "project.openElsewhere": "{name} is already open in another tab — close it there first.",
  "project.starting": "Studio is still starting — please wait a moment, then try again.",
  "project.gone": "This project's files are no longer on disk.",
  "project.deleted": "Deleted {name}",
  "project.deleteFailed": "Couldn't delete {name}: {error}",
  "delete.action": "Delete project",
  "delete.actionAria": "Delete {name}",
  "delete.title": "Delete {name}?",
  "delete.body":
    "This permanently deletes the project and all its files from this browser. It cannot be undone.",
  "delete.confirmLabel": "Type the project name to confirm",
  "delete.confirm": "Delete project",
  "delete.deleting": "Deleting…",
  "create.failed": "Couldn't create the project: {error}",
  "create.ready": "{name} created — run {install} then {dev}",

  // ── Home ─────────────────────────────────────────────────────────────────
  "home.backToWorkspace": "Back to workspace",
  "home.dropHint": "Drop a folder to import it as a new project",
  "home.newProject": "New project",
  "home.newProjectDesc": "A Facilis app — Nitro, PGlite and React, scaffolded and ready to run.",
  "home.importFolder": "Import a folder",
  "home.importFolderDesc": "Open a local folder — or drop one here — as a new project.",
  "home.importRemote": "Import a repository",
  "home.importRemoteDesc": "Fetch a GitHub, GitLab or Gitea/Forgejo repository as a new project.",
  "home.importLocked": "Available once your saved project finishes restoring.",
  "home.recent": "Recent projects",
  "home.recentHint":
    "Your files and installed dependencies are saved in this browser across reloads.",
  "home.noProjects": "No projects yet. Create one above to get started.",
  "home.reset": "Reset everything",
  "reset.title": "Reset everything?",
  "reset.body":
    "This permanently deletes all saved files and cached dependencies from this browser, then reloads Studio with a clean slate. This cannot be undone.",
  "reset.confirm": "Reset everything",
  "reset.busy": "Resetting…",
  "create.title": "New project",
  "create.description": "A Facilis app — Nitro, PGlite and React, scaffolded for you.",
  "create.name": "Project name",
  "create.namePlaceholder": "my-app",
  "create.directory": "Directory",
  "create.directoryPlaceholder": "/home/user/projects/my-app",
  "create.runInit": "Install and run",
  "create.runInitHint": "install dependencies and start the dev server after creating.",
  "create.submit": "Create",
  "create.creating": "Creating…",
  "create.waiting": "Waiting for the runtime…",

  // ── Import from a git host ───────────────────────────────────────────────
  "import.title": "Import a repository",
  "import.description":
    "Fetch a repository — GitHub, GitLab or Gitea/Forgejo — as a new project. Downloaded in your browser, no server involved.",
  "import.host": "Host",
  "import.repository": "Repository",
  "import.repositoryPlaceholder": "owner/repo, owner/repo@branch, or a repository URL",
  "import.repositoryHint":
    "Public by default; a private repository needs a token below. A self-hosted server must allow CORS on its API.",
  "import.token": "Access token (optional)",
  "import.tokenPlaceholder": "ghp_…, glpat-…, …",
  "import.tokenHint":
    "For private repositories: a token with read access. It is used for this import and never stored.",
  "import.tokenInvalid": "That does not look like a valid token.",
  "import.starting": "Starting…",
  "import.submit": "Import",
  "import.progress": "{phase} ({done}/{total})",

  // ── Publish to a git host (D-078) ───────────────────────────────────────
  "push.title": "Publish to a git host",
  "push.description":
    "Commit this project to a GitHub, GitLab or Gitea/Forgejo branch as one commit through the host's API — from the tab, no clone and no server.",
  "push.host": "Host",
  "push.repository": "Repository",
  "push.repositoryPlaceholder": "owner/repo, or a repository URL",
  "push.repositoryHint":
    "The repository must already exist; a self-hosted server must allow CORS on its API.",
  "push.token": "Access token",
  "push.tokenPlaceholder": "ghp_…, glpat-…, …",
  "push.tokenHint":
    "Needs write access (GitHub Contents write, GitLab write_repository, Gitea write:repository). Used for this publish and never stored.",
  "push.tokenInvalid": "That does not look like a valid token.",
  "push.branch": "Branch",
  "push.branchPlaceholder": "main",
  "push.branchHint": "Leave empty to use the repository's default branch.",
  "push.newBranchName": "New branch name",
  "push.createBranch": "Create a new branch",
  "push.message": "Commit message",
  "push.author": "Commit author",
  "push.authorName": "Name",
  "push.authorEmail": "Email",
  "push.authorHint": "Saved in this browser for later publishes.",
  "push.check": "Check changes",
  "push.checking": "Checking…",
  "push.publish": "Publish",
  "push.publishing": "Publishing…",
  "push.summary": "{added} new · {modified} changed · {deleted} deleted",
  "push.summaryTarget": "{branch} from {base}",
  "push.clean": "Nothing to publish — the branch already matches this project.",
  "push.progress": "{phase} ({done}/{total})",
  "push.phaseListing": "Reading the remote branch…",
  "push.phaseUploading": "Uploading files…",
  "push.phaseCommitting": "Creating the commit…",
  "push.success": "Published to {branch}",
  "push.successDescription": "{commits} commit(s) · {repository}",
  "push.openProjectFirst": "Open a project first.",
  "push.kernelStarting": "The runtime is still starting — try again in a moment.",
  "push.disabled": "This deployment does not allow publishing to a git host.",
  ...gitRemoteEn,
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
  "palette.importRemote": "Import a repository",
  "palette.pushRemote": "Publish to a git host",
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
  "chat.instructions": "Project instructions (AGENTS.md)",
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
  "chat.context.agents": "AGENTS.md",
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

  // ── project updates (D-065) ───────────────────────────────────────────────
  "updates.available": "Update available",
  "updates.aheadBadge": "Newer project",
  "updates.tooltip": "Project {project} · this Studio {build}",
  "updates.title": "Project updates",
  "updates.description": "This project was created by an older build of the Studio.",
  "updates.ahead": "This project was created by a newer Studio. Open it there.",
  "updates.projectVersion": "Project version",
  "updates.buildVersion": "This Studio",
  "updates.unknown": "unknown",
  "updates.noRecipe":
    "This Studio ships no upgrade recipe for this jump yet, so nothing is applied automatically. Export the project and recreate it from the current template, or use a build that includes the recipe.",
  "updates.baseline": "Approved baseline: {baseline}",
} as const;
