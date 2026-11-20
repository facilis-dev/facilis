# D-078 — Publishing pushes one commit through the host's REST API; it never runs git
**Status:** accepted (2026-11-01)

D-073 made repository *reading* API-only because a browser tab cannot speak git's smart-HTTP
protocol: no raw socket, no CORS on the git endpoints, no git binary in the WebContainer. Writing
has the same constraint, and the naive reading is that write-back is impossible. It is not: every
host also exposes CORS-enabled REST endpoints that create commits (GitHub Git Data, GitLab
Commits, Gitea contents), so the IDE can *publish* a project without a clone, a relay or a
server. What it cannot do is be a git client.

**Decision.** Add "Publish to a git host" as the write half of D-073: `ide/src/vv/git-push.ts`
plus a per-host adapter (`github-push.ts`, `gitlab-push.ts`, `gitea-push.ts`), planned by
`project-publish.ts`, opened from the command palette and rendered by `PushRemoteDialog.tsx`
(open state in `publish-session.ts`).

- **Diff without git.** The remote branch's tree is listed through the same API (blob ids), the
  VFS files are hashed as git would (`sha1("blob <len>\\0" + bytes)`, `git-blobs.ts`), and the two
  lists are compared. Nothing is downloaded twice and no baseline is persisted: the remote branch
  is the baseline.
- **One commit.** GitHub creates blobs, then a tree with `base_tree` (a `null` sha deletes a
  path), then a commit whose parent is the listed head, then moves the ref with `force: false`.
  GitLab posts `/repository/commits` with an `actions[]` batch (base64 for binary). Gitea has no
  batch endpoint, so it writes file by file through the contents API and reports the real commit
  count — a host limitation, stated rather than hidden.
- **Branch policy.** A publish either commits onto an existing branch or creates a new one from it.
  The plan carries the head it was diffed against; a branch that moved since is a conflict error,
  never a silent overwrite. Force-push, merge, rebase, tags and LFS are out of scope.
- **Secrets.** A token with write scope is required and handed in per publish; it lives in the
  dialog's state and is dropped when the dialog closes (the same rule as D-073's import token).
  The author name/email come from the existing local git identity (`git-config.ts`).
- **Policy.** New deployment key `projects.exports.git`: `true` in the open profile, `false` in a
  managed build. A managed build may opt in — unlike an import this only sends the company's own
  code out — but then requires `network.connect`, because the CSP is what actually reaches the
  host. When the switch is false the build stubs the write layer out (`vite.deployment.ts`, next to
  D-073's import stub; the shared host table disappears only when neither direction is on), and
  `environment.json` records `gitPush`.
- **Excluded paths.** `node_modules`, `.git`, build output (`dist`, `build`, `.next`, `.turbo`,
  `.cache`, `coverage`, `.vite`), `.facilis` and logs never leave the tab — the same intent as the
  SCM walk's ignore list. A publish commits source, not the workspace.

**Rejected alternatives.** A CORS proxy, or the optional network relay (`?net=`), would let a real
git client run (`isomorphic-git` is already a dependency for the local SCM) but reintroduces a
server — L3, against the deployment constraint — and the relay is loopback-only and per-launch, so
neither fits a static deployment. A per-file GitHub contents loop would work but create N commits
where the API offers one. GitHub Enterprise stays unsupported for the same reason as D-073.

**Consequences.** A project created or edited in the IDE can be published to GitHub, GitLab or
Gitea/Forgejo from the tab, onto a new branch by default. It is not a git client: there is no pull
or merge, the local commits the SCM panel made are not replayed (what is published is the working
tree, hashed the way git hashes it), executable bits are not preserved, and a single file over
40 MB or a project over 200 MB is refused. `isomorphic-git` stays local-only.
