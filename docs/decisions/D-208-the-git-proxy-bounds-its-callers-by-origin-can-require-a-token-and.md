# D-208 — The git proxy bounds its callers by origin, can require a token, and rate-limits at the edge
**Status:** accepted (2026-11-21)

Drafted on the branch as D-202; renumbered to the next free ID, **D-208**, when the branch was
rebased onto main, where D-202–D-207 had already landed. Every "D-202" reference in the two
branch commits means this decision.

D-079 made the proxy stateless, logging-free and bounded by an upstream host allowlist. It said
nothing about the caller: any client could drive it to an allowlisted host, and any web page could
call it cross-origin because the CORS answer was `*`. That is not an open proxy — the host
allowlist rules out a third site and an internal address — but it is an anonymizing hop toward the
allowlisted hosts, and the deployment's egress is what the host's abuse detection and the
operator's Workers quota see.

**Decision.** Bound the caller at the edge, and keep the handler stateless.

- **Origin, in the handler** (`ide/git-proxy/caller.mjs`). A request that carries an `Origin`
  header must come from the deployment's own host (host+port; the scheme is ignored, because a
  TLS-terminating reverse proxy presents the handler an http:// request URL) or from an origin
  named in `GIT_PROXY_ALLOWED_ORIGINS`. `Origin: null` is refused like any other foreign origin,
  and CORS is echoed per origin instead of `*`, so a page that is not the caller cannot even read
  the refusal. A request with no `Origin` header is not a browser (native git, the availability
  probe) and passes: a browser cannot attribute it anyway, and the host allowlist still bounds it.
- **Token, by default, in the handler.** A request without an `Authorization` header on
  `info/refs`, `git-upload-pack` or `git-receive-pack` is refused with `401`. A host's login
  endpoints (GitHub's device flow) stay anonymous: they are where the token comes from, and a
  preflight carries no header at all, so it is answered before this check. The host verifies the
  token — this file only refuses the anonymous caller — so every clone through the proxy is
  attributable and the volume leaves the anonymous-IP path that hosts police. A deployment that
  wants anonymous public clones opts out with `GIT_PROXY_REQUIRE_AUTH=0` (or
  `--allow-anonymous`); that is the explicit exception, not the default.
- **Rate limiting, outside the handler.** A WAF rate-limiting rule on `/git-proxy/*` per IP is
  the only control that bounds volume, and it cannot live in this process without making it
  stateful. It is the operator's configuration, documented in `docs/DEV.md` §10 together with the
  billing alerts that make a spike visible.

**Rejected.** A shared secret or a signed per-request token: the IDE is a static bundle, so
anything it ships is public, and there is no server to mint a credential. A path allowlist limited
to the three git endpoints: it would shrink the surface further, but the endpoints are a closed
set only for the hosts we know, and rate limiting already bounds the volume that makes a hop
worth using — it stays a candidate if the allowlist ever has to grow.

**Consequences.** A cross-origin deployment must name the IDE origin (`GIT_PROXY_ALLOWED_ORIGINS`
in the Pages project, `--allow-origin` on the standalone server); same-origin needs no
configuration, because the deployment's own host is always the caller. Anonymous clones of public
repositories are the behaviour the default costs: the copy in the git dialogs now says the token
may be required for any repository, and an anonymous clone that the proxy refuses with 401 is
surfaced with a dedicated message ("this installation's git proxy requires a token") that keeps
the import dialog open on the token field — it does not silently fall back to the REST importer,
which would lose the .git history without explaining why. The REST fallback remains for
deployments without a working proxy and for clone failures unrelated to the token requirement.
The handler stays stateless, logging-free and storage-free, and the host allowlist stays the
outer boundary.
