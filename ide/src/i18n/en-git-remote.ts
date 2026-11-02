// The git-network strings (D-079 to D-081), spread into `en` in en.ts.
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
  "gitRemote.token": "Access token or password (optional)",
  "gitRemote.tokenPlaceholder": "ghp_…, glpat-…, …",
  "gitRemote.tokenHint":
    "Needed for private repositories and for pushing. GitHub accepts a token only; GitLab and Gitea/Forgejo also accept your account password. Used for this operation and never stored.",
  "gitRemote.username": "Username (optional)",
  "gitRemote.usernamePlaceholder": "git",
  "gitRemote.usernameHint":
    "Only with an account password (GitLab, Gitea/Forgejo), or when the host asks for one with the token.",
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
  "import.descriptionGit":
    "Fetch a repository — GitHub, GitLab or Gitea/Forgejo — as a new project with a real git clone. The download goes through this installation's stateless proxy, which keeps nothing and logs nothing.",
  "import.repositoryHintGit":
    "owner/repo (GitHub by default) or the repository URL; GitLab and Gitea/Forgejo need their URL. A private repository needs the token or password below.",

  // ── import with real git: token or account password (D-081) ─────────────
  "import.secretInvalid": "That does not look like a valid token or password.",
  "import.tokenOrPassword": "Access token or password (optional)",
  "import.tokenOrPasswordHint":
    "For a private repository. GitHub accepts a token only; GitLab and Gitea/Forgejo also accept your account password with the username below. Used for this import and never stored.",
  "import.username": "Username (optional)",
  "import.usernamePlaceholder": "your username",
  "import.usernameHint":
    "Only with an account password (GitLab, Gitea/Forgejo) — GitHub requires a token.",

  // ── token help (shown by the import, publish and remote dialogs) ─────────
  "token.helpSummary": "How to create a token",
  "token.githubLine": "Settings › Developer settings › Personal access tokens — {scope}",
  "token.gitlabLine": "Preferences › Access tokens — {scope}",
  "token.giteaLine": "Settings › Applications — generate a token with {scope}",
  "token.scopeGithubRead": "Contents: Read",
  "token.scopeGithubWrite": "Contents: Read and write",
  "token.scopeGitlabRead": "read_repository",
  "token.scopeGitlabWrite": "write_repository",
  "token.scopeGiteaRead": "read:repository",
  "token.scopeGiteaWrite": "write:repository",

  // ── empty repository → scaffold the Facilis project (D-080) ──────────────
  "palette.scaffold": "Create a Facilis project in this folder",
  "clone.emptyTitle": "The repository has no Facilis project yet",
  "clone.emptyDescription":
    "It is cloned and opened; add the Facilis app here and then commit and push it.",
  "clone.emptyAction": "Create the project",
  "scaffold.doneTitle": "Facilis project created",
  "scaffold.doneDescription": "Run it, then commit and push from Source Control.",
  "scaffold.alreadyProject": "This folder already contains a project.",
  "scaffold.failed": "Could not create the project: {error}",
  "scaffold.status": "created the Facilis project",
  "scaffold.kernelStarting": "The runtime is still starting — try again in a moment.",
} as const;
