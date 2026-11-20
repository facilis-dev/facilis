# D-073 — Git import reads the host's CORS-enabled API; no SSH, no token storage
**Status:** accepted (2026-11-01)

Import needs private repositories, and not just GitHub. A browser tab cannot speak git's
smart-HTTP or SSH (no raw socket), so the only path is the host's HTTPS API: it must send CORS
headers, and the page fetches it directly. Measured 2026-11-01: GitHub's API (and
\`raw.githubusercontent.com\`), GitLab's \`/api/v4\` (cloud and self-hosted) and Gitea/Forgejo's
\`/api/v1\` all answer \`Access-Control-Allow-Origin: *\`, and their preflights allow the auth
headers we send (GitHub \`Authorization\`, GitLab \`private-token\`, Gitea \`Authorization\`).
Self-hosted Gitea/Forgejo need \`[cors]\` enabled; GitLab's API sends it by default. SSH is
impossible in the tab, and a host without CORS cannot be imported — that is a server setting,
not a client workaround.

**Decision.** \`git-provider.ts\` owns the host table, the URL parsing and the per-host auth
header (\`Authorization: Bearer\` on GitHub, \`PRIVATE-TOKEN\` on GitLab, \`Authorization: token\`
on Gitea/Forgejo); \`git-import.ts\` reads the tree and the blobs per host (GitHub keeps
\`raw.githubusercontent.com\` for public repositories and uses the contents API when a token is
given; GitLab and Gitea/Forgejo are API-only, with paginated tree walks). The token is optional,
normalized (\`normalizeGitToken\`), never written to storage and never put in a URL: the dialog
holds it and drops it when it closes. GitHub Enterprise is out of scope for now: its API lives
at \`/api/v3\` and its raw host differs, so the GitHub adapter's fixed URLs would be wrong.

**Consequences.** GitHub, GitLab (cloud and self-managed) and Gitea/Forgejo can be imported
from the tab; a private repository works with a read token; nothing is persisted, so a second
import asks for the token again (PAT-per-host storage stays Phase 2, with the encrypted-OPFS
design in SPEC §10). A managed build compiles the whole git import out (D-063), so this
capability exists only in the open profile. Bitbucket Cloud is not wired yet (directory-walk
API, Basic auth); its API does send CORS, so it is a follow-up adapter, not a new decision.
