# D-082 — GitHub sign-in uses the OAuth device flow; the other hosts keep a pasted token
**Status:** accepted (2026-11-02)

D-081 made a token or password the only way in, which left a 2FA GitHub account with the
token dance and everyone with a secret to paste. The proposal was "send the user to the host,
run OAuth, come back with the token". That works for GitLab and Gitea/Forgejo (public client
plus PKCE) and not for GitHub: its authorization-code exchange requires the client secret,
which a static SPA cannot hold.

**Decision.** Sign in to GitHub with the device flow. Keep the pasted token as the path for
GitLab, Gitea/Forgejo and for users who prefer a PAT.

- **Why the device flow.** GitHub documents it for public clients: the tab asks for a code,
  the user enters it at `github.com/login/device` (where 2FA lives), and the tab polls for the
  token. No client secret, no extra server, no redirect URI, no CORS header.
- **Same proxy.** The two OAuth endpoints are on github.com and send no CORS headers, so the
  existing stateless proxy carries them exactly as it carries git. No new host, no new route
  family, nothing stored or logged.
- **Configuration belongs to the deployment.** `projects.gitOAuth.github.clientId` names the
  OAuth app (public client id only) and is off by default; it requires `gitProxy` and an
  enabled direction, and a managed build may enable it for push-only. Without it the dialogs
  keep asking for a token.
- **The token is per tab, in memory.** No localStorage, no OPFS, no cookie; closing the tab or
  signing out drops it. The token field stays editable, so a PAT still works, and the REST
  fallback keeps using the token it is given.
- **Scope.** `repo` is the only GitHub scope that covers a private clone/push; GitHub has no
  read-only private scope, so the consent screen says so and the token remains revocable.

**Rejected alternatives.** The redirect code flow for GitHub needs the client secret in the
SPA (or a new token-exchange endpoint holding it): a server secret and a stateful piece in a
design whose proxy is deliberately stateless. OAuth for GitLab and Gitea/Forgejo with PKCE is
possible, but their tokens are short-lived with refresh tokens and the same token field already
works; that is its own project (D-081). A GitHub App token is finer-grained but still needs a
server-side exchange or the device flow, for the same UX.

**Consequences.** A 2FA GitHub account signs in without minting a PAT; the device code is the
only thing shown, and the second factor never reaches Facilis. The OAuth app is registered
once per deployment with device flow enabled; its client id is public. The proxy operator sees
the token in transit as with a PAT (D-079). GitLab, Gitea/Forgejo and self-hosted hosts are
unchanged: username/password where the host allows it, token otherwise.
