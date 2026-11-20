# D-080 — An empty repository is populated with the Facilis project, not left empty
**Status:** accepted (2026-11-01)

D-079 made real git work, but the most common "start on GitHub" case still dead-ended: a
repository created empty — or holding only a README — clones to a folder with no
`package.json`, so there is nothing to run, no manifest, and the user had to create a project
somewhere else and re-point a remote at it.

**Decision.** Treat an empty clone as a place to start, not as a failure.

- **Detect, don't clone nothing.** `cloneRepo` asks the remote for its refs first. When it
  advertises none, there is nothing to fetch and no HEAD to check out, so the IDE initialises
  git locally on the remote's advertised HEAD (`main` when it does not say) and keeps
  `origin` — the folder is a valid, empty repository with the right remote (D-080).
- **Offer the one template.** After a clone whose tree has no `package.json` (empty or
  README-only), the IDE offers to write the Facilis project into that folder. The same action
  is a palette command (`Create a Facilis project in this folder`), so it is reachable without
  a clone. Scaffolding writes the template's files only where nothing exists: an existing
  README is kept, `.git` is untouched, and the run manifest is registered so Run works.
- **No automatic commit.** The scaffold is left as a change in Source Control: the user reviews
  it, commits and then pushes with `Remote git` (D-079). Auto-committing would both invent the
  first history entry and hide the files from review.

**Consequences.** An empty repository goes clone → create project → run → commit → push without
leaving the IDE, and a README-only repository keeps its README. The detection costs one
`getRemoteInfo` round trip per clone (it is also what distinguishes an empty repository from an
unreachable one, which must still fail loudly). In a managed build the clone is unavailable
(`imports.git` stays false), but the palette action still populates an empty folder with the
sanctioned project, which is exactly the admission contract.

**Amended (2026-11-12).** The bullet above offered the *default* template only, which meant the
full-stack one reached an empty repository without the user choosing it. The new-project dialog
already ships a picker of the registered templates (D-168), so the empty-repository action now
opens the same picker instead of scaffolding silently: the clone toast's action and the palette
command call the scaffold dialog, and `ProjectImport.scaffoldFolder(root, template)` forwards the
choice to `scaffoldFacilisProject`. Nothing else changes — existing files are still kept and the
scaffold is still left uncommitted for review.
