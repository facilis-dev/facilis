# D-139 — The AI gets a git tool family: inspect, stage, commit, branch, sync, open a pull request
**Status:** accepted (2026-11-10)

The owner asked for the whole git surface in the chat: "tutta la parte di tool per gestire i
commitment sul repository e eventuali pull request o comunque tutta la parte di git". The AI could
already read the project and write validated patches, but it could not see what was modified, make
the commit, or open the pull request — the developer had to leave the chat for every step.

**Decision.**

- The PTC runtime gains a `git_*` family, registered like the preview (D-111) and graph (D-126)
  families through the host seam (`PatchContextHost.git`, `createGitAccess`): `git_status`,
  `git_diff`, `git_log`, `git_branches`, `git_remote`, `git_stage`, `git_unstage`,
  `git_commit`, `git_branch`, `git_sync`, `git_pull_request`. Signatures and returns are in
  [PTC.md](./PTC.md) §6.
- **Repository operations, not source writes.** The facade drives the IDE's own sessions —
  `ScmSession` (index/history/refs) and `GitRemoteSession` (the D-079 proxy) — and never shells
  out. Staging mutates the index; `git_commit` writes a local commit; the AI still authors source
  only as a validated patch set plus the user's Apply (invariant 9 unchanged). Diffs are read
  through a narrow blob/index/workdir port (`git-repo.ts`), not by handing the model `.git`.
- **Destructive operations do not exist.** No discard, reset, clean, rebase or force-push tool.
  The operations that move the working tree — branch switch and pull — refuse a dirty tree with
  `{ ok: false, reason }` as data, so uncommitted work can never be clobbered.
- **One credential, no arguments.** The only token the tools use is the tab-memory GitHub OAuth
  token from the existing device flow (`githubSessionToken()`, D-082). No tool accepts a token
  argument; nothing is persisted, logged or returned, and no token ever enters a URL. Without a
  session (or for a GitLab/Gitea remote in v1) the call answers `{ available: false, reason }`
  and the prompt tells the model to ask the user to sign in — never to invent a credential.
- **Pull requests.** `git_pull_request` posts to the GitHub REST API with the parsed origin repo
  and returns the number and URL. GitLab and Gitea/Forgejo are a deliberate v1 gap: their push
  flows take a per-operation pasted token that is not retained tab-wide, so implementing PR
  creation there would first require a credential-store decision; the tool reports
  `{ available: false }` and the user can open the PR from the host UI.
- **State, not exceptions.** "No project", "no repository", "not signed in", "wrong provider" and
  "dirty tree" are data the model can report or act on; argument errors are `PtcToolError`s naming
  the field and signature. Caps: diff 24 KB/100 files, log 30 entries. Write operations refresh
  the SCM panel and the remote snapshot so the UI follows the tool.
- The prompt gains a `## The project repository` section only when `git_*` tools are advertised
  (generated from the same registry, per D-101), telling the model that a commit is local until
  pushed and that the user owns the sign-in.

**Rejected.** A shell/exec tool or a raw `.git` reader (violates "never exposed" and the sandbox
model); a token argument or an AI-settings credential store (a second trust boundary, and tokens
in model context); discard/reset/force-push (irreversible, and the chat is not the place for
them); GitLab/Gitea PR creation now (see above).

**Consequences.** The owner can ask the assistant to review the changes, commit them with a
message, push the branch and open the PR without leaving the chat; every step is a trace row. The
source write path, the 17-rule validator and the apply/undo contract are untouched: no tool
*authors* source content, so a working-tree edit still needs a proposal + Apply. The only tools
that change existing working-tree bytes are branch switch and pull, and they refuse a dirty tree
first. A pull rewrites the working tree: D-140 gives it (and checkout/discard) one reload path
that refreshes the SCM list and the Explorer and reloads the open editor buffers while keeping
unsaved ones.

**Verification.** `git-access.test.ts` (status/diff/stage/commit/branch/sync/PR over fake ports,
token absent, dirty-tree refusals, provider gate), `git-sync.test.ts`, `ptc/git-tools.test.ts`
(dispatch, argument validation, availability as data), prompt tests (the section appears only with
`git_*`), focused IDE vitest, typecheck, file-length and lint gates.
