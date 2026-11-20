# D-088 — The Source Control panel opens a commit graph as an editor-area tab
**Status:** accepted (2026-11-02)

The SCM panel (inherited from Vivari) shows a flat, 20-commit History list. A repository
now really has branches, merges and — since D-079/D-080 — remotes, so the one question the
list cannot answer at a glance is "how do these branches relate?". The IDE already carries
React Flow (`@xyflow/react`, D-085) and the synthetic-tab mechanism D-087 built for the API
Flow, so a graph needs no new dependency and no new surface type.

**Decision.** Add a `commit-graph` editor tab, one per repository, opened from a git-fork
button in the SCM panel's repo header, and draw the local object graph with React Flow.

- **Local-only read.** A new `CommitGraphSession` reads the repository through the same
  `GitFs` + isomorphic-git path as `ScmSession`: `listBranches` + `resolveRef` for the
  branch tips, `currentBranch` for HEAD, and `log` per ref (default 60 commits per ref,
  200 total, deduplicated by oid, newest first). There is no network, so the tab works
  offline and in a managed build exactly like the SCM panel; no deployment profile gates it.
  The shared lazy isomorphic-git + Buffer loader moved from `scm-session.ts` to
  `vv/git-api.ts` so both readers use one import.
- **Pure layout.** `facilis/commit-graph-model.ts` is React-free and git-free: it assigns
  lanes gitk-style (a commit continues the lane waiting for its oid, a merge opens a lane per
  extra parent, freed lanes are reused) and exports the node/edge/position types plus
  `GRAPH_LAYOUT`, so the canvas only renders. A commit whose parent fell outside the read
  limit simply loses that edge.
- **The tab.** A synthetic `vv-commit-graph:<root>` tab (helpers in `synthetic-tabs.ts`,
  because the controller is pinned by the file-length ratchet) rendered by `EditorGroup`;
  the tab label is the repository's name and the tooltip is its path. Cards show the subject,
  short oid, author, date, the branches pointing at the commit and a HEAD badge on the current
  branch; lane colours cycle five theme roles, never raw palette values (D-043/D-044). A
  details inspector shows the full hash and lets a branch badge check that branch out through
  `ScmSession.checkoutBranch` (shared busy/error channel with the panel).
- **Refresh on HEAD, not on status.** The graph loads on open and on refresh, and reloads when
  the SCM snapshot's HEAD signature (`branch:tip oid`) changes — a commit or a branch switch
  shows up without pressing anything, while ordinary status walks do not trigger a git log.
- **Focus.** The same one-click focus control as the API Flow (hide sidebar, preview and bottom
  panel) because a lane graph needs width.

**Rejected alternatives.** A sidebar graph: D-087 already established that a graph at 16% width
is unreadable. A bespoke SVG implementation: React Flow is a dependency, its theme bridge
already exists, and a second canvas would duplicate pan/zoom/fit. Reading the log during every
status refresh: it contends with the terminal on the kernel worker thread for a panel opened
rarely. Persisting the tab across reloads: no synthetic tab is restored today, and restoring one
would need a project/root lookup at boot. A server-side graph: there is no server; the git proxy
is a stateless pass-through and never inspects a repository (D-079).

**Consequences.** Branches and merges are visible at a glance and readable at center width. A
deep history is silently truncated at the read cap (no "load more" yet), and the tab is read-only:
every write (commit, checkout, discard) stays in the SCM panel. `scm-session.ts` and
`controller.ts` did not grow: the shared git loader moved out and the diff editor moved to
`vv/diff-session.ts` (D-089) to pay for `openCommitGraph()`.

**Verification.** 10 model tests (linear, merge, branch/HEAD marking, truncation, determinism,
non-overlap, lane reuse, empty input) and 7 session tests (branch-log merge, detached HEAD,
depth/limit, missing repository, error wrapping); the IDE suite is 595 tests in 78 files. A
browser run on a project with four commits over two branches renders 4 nodes, 3 edges and 2
lanes: the repo-header button opens the tab, HEAD and branch badges and the details inspector
are present, focus widens the canvas from ~700 px to 1136 px, and commits and branch switches
appear without a manual refresh. No page errors, no failed requests; full gate set green.
