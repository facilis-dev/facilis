# D-123 — A new project starts as a git repository
**Status:** accepted (2026-11-08)

The generated project ships a `.gitignore` and D-065 relies on the project's git history as the
undo for updates, but "New project" left the folder uninitialized: the ignore rules did nothing
until the user ran Source Control → Initialize, and a user who initialized later could stage
`node_modules/` before noticing.

**Decision.** `createProject` calls the existing `ScmSession.init` after the template is written
and the folder is open. Init is idempotent (`git init` on an existing repo is a no-op), seeds the
default `.gitignore` only when the project lacks one, and uses `main` as the default branch. It
creates no commit: the user reviews and commits from Source Control. The GitHub clone/scaffold
paths are untouched — they already have `.git`.

**Consequences:** the new project appears in Source Control immediately as an untracked repo; the
isomorphic-git chunk loads lazily on creation; no network is involved.
