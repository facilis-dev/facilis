# D-035 — A project is its directory: one folder per tab, the folder name is the label
**Status:** accepted (2026-10-30)

The Studio inherited Vivari's multi-root workspace, and the IDE inherited its label from
whichever name/title happened to be at hand. Two consequences, both measured by the user:

- `openFolder()` **appended** a root instead of replacing it, so opening a second project added
  it to the same Explorer: one tab showed two projects at once, while the Web Lock, the run
  phase and the browser title still described "the" project.
- The label was a **stored or separate name** — the create-form name, the kernel manifest's
  title, the registry's stored name — none of which is the directory. Measured:
  `/home/user/projects/facilis-ts-appx` displayed as `facilis-ts-app`, indistinguishable from
  the project already open, because the label and the folder could drift.

**Decision:** the directory is the project. A tab holds **one** workspace folder and the label
is that folder's name:

- `openFolder()` closes the tab's other roots first; the editor tabs/models/index and the
  project's Web Lock follow the folder. Opening another project *replaces* the project in that
  tab; "Open in a new tab" is how two projects are worked on at once.
- `?project=<rootPath>`, the browser title, the Web Lock, the run phase and the Explorer all
  describe that one project.
- `projectName(rootPath)` (the last path segment) is the **only** label source: the Explorer
  root, the title bar, the browser title and Home's recent rows all derive from it.
  `WorkspaceFolder.name` and `snap.projectTitle` are derived, not authored.
- `ProjectMeta` no longer stores a name: it is
  `{ rootPath, template, createdAt, lastModified }`, and a legacy registry entry's `name` is
  ignored on read.
- The create dialog's project-name field only seeds the default directory; the project's
  label, the kernel's project title, and a blank project's `package.json`/`README` use the
  folder name.

**Consequences:** a tab cannot show two roots, and a project cannot be mislabelled by a stale
title or a name typed at creation. Home's recent-projects registry is per origin, so it stays a
read-merge-write (D-033): a tab must merge its own paths, never rewrite the whole list.
Acceptance: `pnpm ide:smoke:multitab` asserts one root and the directory label; the two
existing smokes stay green.
