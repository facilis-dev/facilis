# D-079 — Real git runs over HTTPS through a stateless, logging-free proxy
**Status:** accepted (2026-11-01)

D-078 made the IDE *publish* through the hosts' REST APIs, and that is not a git client: no
clone with history, no fetch, no pull, no branches, no merge. The requirement is full git over
HTTPS (SSH is not required). The blocker is CORS, not the protocol: measured on 2026-11-01,
`github.com` (401), `gitlab.com`, `gitea.com` and `codeberg.org` (200) answer git smart-HTTP
requests with no `access-control-*` header at all, and their preflights are rejected. A tab
therefore cannot reach a git endpoint directly, and no client-side trick changes that.

**Decision.** Speak real git in the tab, through one stateless proxy hop.

- **The proxy** (`ide/git-proxy/handler.mjs`) is a Worker- and Node-compatible `fetch` handler
  mounted at `/git-proxy/<host>/<path>`: it forwards to `https://<host>/<path>` and adds the
  CORS headers the missing upstream does not send. The hosted IDE gets it on its own origin as
  a Cloudflare Pages Function (`ide/functions/git-proxy/[[path]].ts`), so the browser needs no
  CORS at all and `connect-src 'self'` already covers it; `pnpm ide:dev` gets the same handler
  as Vite middleware (`ide/vite.git-proxy.ts`); a self-hosted deployment runs
  `scripts/dev/git-proxy.mjs` (the same handler in an `http.Server`) and points
  `projects.gitProxy` at it.
- **It saves nothing and logs nothing.** No storage, no cache, no cookies, no per-request output
  (no `console` at all), and request bodies are never read or buffered: bodies and responses are
  streamed through, the token in `Authorization` only transits memory and is never echoed or
  logged. Forwarded request headers are an allowlist (`authorization`, `content-type`, `accept`,
  `user-agent`, `git-protocol`); `origin`, `referer`, `cookie` and the proxy's own headers are
  dropped. Upstream is always HTTPS, and the upstream host must be on the deployment's allowlist —
  no wildcard, and loopback/private hosts are not in the defaults (an allowlisted loopback would
  turn the proxy into an SSRF ladder into its own network).
- **The client** is `isomorphic-git` (already a dependency for the local SCM): `ide/src/vv/git-http.ts`
  is the http plugin that rewrites `https://<host>/<path>` to `<proxyBase>/<host><path>`, and
  `git-remote.ts` adds clone (full history), fetch, pull (fast-forward only), push and
  ahead/behind, over the same VFS adapter the SCM panel writes with. `git-remote-session.ts` is
  the panel's store. Tokens are per operation, passed to `onAuth`, never stored (D-073's rule);
  the author identity stays the local one (`git-config.ts`).
- **Import and publish become real git.** A git clone keeps `.git`, so the Source Control and
  remote panels work on the project immediately; the D-073 REST importer and the D-078 REST
  publish remain available where no proxy exists (a bare static host) and are offered only as
  that fallback.
- **Deployment.** `projects.gitProxy` is `"same-origin"` in the open profile and `null` in a
  managed build; enabling real git in a managed build is an operator decision (`exports.git` for
  push-only, which is the managed default, since `imports.git` stays false there) and a
  cross-origin proxy must be listed in `network.connect` because the CSP is what reaches it.
  With no proxy the whole remote half is stubbed out of the bundle (`vite.deployment.ts`), and
  `environment.json` records `gitProxy`.

**What "full git" does and does not mean.** HTTPS only: SSH needs raw TCP, so it would need a local
relay/agent and is out of scope. Clone/fetch/pull/push, branches, lightweight tags, history and
commits are real; LFS and submodules are not implemented by isomorphic-git; a diverged pull is
reported as a conflict instead of a 3-way merge in this change (merge and rebase are follow-ups);
a single pack is bounded by the host's and the proxy platform's request limits.

**Rejected alternatives.** A local helper/agent would give SSH, real merge and LFS, but it is an
install step on every employee's machine — the option to revisit if SSH becomes a requirement. A
third-party public proxy (cors.isomorphic-git.org and friends) would put every token in someone
else's logs. Emulating git through the REST APIs (D-078) is not git, which is the objection that
started this change.

**Consequences.** `ide.facilis.dev` gets real git with no extra infrastructure; a self-hosted
static deployment must run the reference proxy (one `node` process, no state to back up) and
declare it. The proxy operator is inside the trust boundary for the duration of a request, so the
same-origin Pages Function is the recommended shape and a company proxy should live in the
company's own network.
