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
import { updatesEn } from "./en-updates";
import { dataExplorerEn } from "./en-data-explorer";
import { dataQueryEn } from "./en-data-query";
import { releasePreviewEn } from "./en-release-preview";
import { gitRemoteEn } from "./en-git-remote";
import { sourceControlEn } from "./en-source-control";
import { commitGraphEn } from "./en-commit-graph";
import { projectGraphEn } from "./en-project-graph";
import { chatEn } from "./en-chat";
import { logsEn } from "./en-logs";
import { tourEn } from "./en-tour";
import { runEn } from "./en-run";
import { previewEn } from "./en-preview";
import { scaffoldEn } from "./en-scaffold";
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

  // ── working tree (git rewrote files) ────────────────────────────────────
  "editor.workdir.unsavedKept":
    "Git updated the working tree: {n} open file(s) with unsaved changes kept their buffer. Save them over the pulled files deliberately.",

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
  "home.newProjectDesc": "Start from a template — a full-stack app or a static site.",
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
  "create.description": "Choose a starting point, then name the project.",
  "create.template": "Template",
  "create.template.todo": "Full-stack app",
  "create.template.todoDescription":
    "Nitro + PGlite + React, with auth, todos, file uploads and jobs.",
  "create.template.showcase": "Static showcase site",
  "create.template.showcaseDescription": "Vite + React + Tailwind, frontend only — no backend.",
  "create.template.starter": "Empty full-stack app",
  "create.template.starterDescription":
    "Nitro + PGlite + React with the standard login only — no demo app to delete.",
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
  "import.repository": "Repository",
  "import.repositoryPlaceholder": "owner/repo, owner/repo@branch, or a repository URL",
  "import.repositoryHint":
    "Public by default; a private repository needs a token below. A self-hosted server must allow CORS on its API.",
  "import.tokenInvalid": "That does not look like a valid token.",
  "import.starting": "Starting…",
  "import.submit": "Import",
  "import.progress": "{phase} ({done}/{total})",

  // ── Publish to a git host (D-078) ───────────────────────────────────────
  "push.title": "Publish to a git host",
  "push.description":
    "Commit this project to a GitHub, GitLab or Gitea/Forgejo branch as one commit through the host's API — from the tab, no clone and no server.",
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
  ...scaffoldEn,
  ...sourceControlEn,
  ...commitGraphEn,
  ...projectGraphEn,
  ...dataExplorerEn,
  ...dataQueryEn,
  ...releasePreviewEn,
  ...updatesEn,

  // ── bottom panel, status bar and run (D-124) ────────────────────────────
  ...runEn,

  // ── title bar ────────────────────────────────────────────────────────────
  "title.home": "Home",
  "title.newTab": "New tab",
  "title.openNewTab": "Open Studio in a new tab",
  "title.toggleSidebar": "Toggle sidebar",
  "title.togglePreview": "Toggle preview",
  "title.tagline": "a real dev server, in your browser",

  // ── status bar ───────────────────────────────────────────────────────────
  "status.branch": "Current branch",
  "status.goToLine": "Go to Line/Column",
  "status.indent": "Select indentation",
  "status.language": "Select language mode",
  "status.python": "Python language service (jedi, black)",
  "status.position": "Ln {line}, Col {column}",
  "status.error": "error",
  "status.errors": "errors",
  "status.warning": "warning",
  "status.warnings": "warnings",
  "status.selections": "({count} selections)",
  "status.selected": "({count} selected)",
  // Device health (device-health.ts): one readout per issue the signals warrant.
  "status.device.memoryPressure": "Memory pressure",
  "status.device.lowMemory": "Low RAM",
  "status.device.slowBoot": "Slow start",
  "status.device.lowStorage": "Storage nearly full",
  "status.device.hint":
    "This tab runs the whole VM. Closing other tabs and apps frees the memory it needs.",

  // ── preview panel ────────────────────────────────────────────────────────
  ...previewEn,

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
  "palette.tour": "Show the IDE Tour",
  "palette.exportZip": "Export Project as Zip",
  "palette.shareProject": "Share Project (copy link)",
  "palette.toggleTerminal": "Toggle panel",
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
  ...chatEn,

  // ── operator logs (D-119) ────────────────────────────────────────────────
  ...logsEn,

  // ── guided tour (D-128) ─────────────────────────────────────────────────
  ...tourEn,
} as const;
