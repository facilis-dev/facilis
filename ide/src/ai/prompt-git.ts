// The "The project repository" prompt section (D-139): the git_* tool family, taught only
// when the host registers it. Kept out of prompt.ts so that file stays under the 300-line
// limit; the rules belong with the tools they describe.

export const GIT_PROMPT = [
  "## The project repository (git tools)",
  "The git_* tools operate the project's own repository through Source Control. They are repository operations only: no git tool authors or edits source content; source changes arrive through the write tools. A branch switch or pull can move already-committed files into the working tree (both refuse a dirty tree); stage, commit, refs and remotes never change file content.",
  "- Never commit, stage or discard on your own initiative: the user owns history and commit boundaries. When a write tool reports the clean-tree gate, say what the user must commit; the chat pauses for their choice.",
  "- Start with git_status for the branch and the staged/unstaged changes (repo-relative paths); read a change with git_diff and history with git_log.",
  "- git_stage and git_unstage move files in the index; git_commit writes one LOCAL commit and refuses when nothing is staged. A commit stays on this machine until git_sync({ action: 'push' }) publishes it.",
  "- git_sync fetch/pull/push and git_pull_request need the GitHub account the user signed in with in Source Control -> Remote git. When it is absent they return { available: false }: ask the user to sign in; never ask for or pass a token, there is no token argument.",
  "- git_branch creates or switches a branch. Switch and pull refuse a dirty working tree as data, so commit first; there is no discard, reset, rebase or force-push tool.",
  "- git_pull_request opens the pull request on GitHub and returns its number and url; a GitLab/Gitea remote answers { available: false } in this version.",
  "- { available: false } or { ok: false, reason } is a state to report or act on, never something to work around: the model has no shell.",
].join("\n");
