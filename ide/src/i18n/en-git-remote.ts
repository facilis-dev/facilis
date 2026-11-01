// The D-079 git-remote strings, spread into `en` in en.ts.
//
// The catalogue is at the 300-line limit, so this feature block lives in its own
// module instead of growing en.ts; the keys stay flat and their values unchanged.
export const gitRemoteEn = {
  "gitRemote.title": "Git remotes",
  "gitRemote.description":
    "Fetch, pull and push with real git, through this deployment's stateless proxy.",
  "gitRemote.remote": "Remote",
  "gitRemote.remotePlaceholder": "https://github.com/owner/repo.git",
  "gitRemote.save": "Save remote",
  "gitRemote.saved": "Remote saved",
  "gitRemote.token": "Access token (optional)",
  "gitRemote.tokenPlaceholder": "ghp_…, glpat-…, …",
  "gitRemote.tokenHint":
    "Needed for private repositories and for pushing. Used for this operation and never stored.",
  "gitRemote.username": "Username (optional)",
  "gitRemote.usernamePlaceholder": "git",
  "gitRemote.usernameHint":
    "Only for hosts that need a username together with the token (Gitea/Forgejo).",
  "gitRemote.branch": "Branch",
  "gitRemote.aheadBehind": "↑{ahead} ↓{behind}",
  "gitRemote.upToDate": "Up to date with the remote.",
  "gitRemote.fetch": "Fetch",
  "gitRemote.fetching": "Fetching…",
  "gitRemote.pull": "Pull",
  "gitRemote.pulling": "Pulling…",
  "gitRemote.push": "Push",
  "gitRemote.pushing": "Pushing…",
  "gitRemote.detecting": "Checking the remote…",
  "gitRemote.pullHint":
    "Pull fast-forwards only: if the branches diverged it reports a conflict instead of merging.",
  "gitRemote.successFetched": "Fetched from the remote.",
  "gitRemote.successPulled": "Pulled the remote branch.",
  "gitRemote.successPushed": "Pushed the branch.",
  "gitRemote.notRepository": "This project has no git remote yet — add its URL below.",
  "gitRemote.unavailable":
    "Real git needs the deployment's stateless proxy, and this build has none (or it is unreachable).",
  "gitRemote.openProjectFirst": "Open a project first.",
  "gitRemote.kernelStarting": "The runtime is still starting — try again in a moment.",
  "palette.gitRemote": "Git remotes…",
  "import.cloneHint": "Real git clone — keeps the full history and the .git folder.",
} as const;
