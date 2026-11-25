# D-212 — GET routes are side-effect free
**Status:** accepted (2026-11-25)

SPEC §8.6 has required GET routes to be side-effect free since D-141: `SameSite=Lax` sends
the session cookie on a cross-site top-level GET navigation, so a state-changing GET is
CSRF-able even with the origin gate, which covers unsafe methods only. The runtime gate
stays the security authority, but nothing checked the contract statically — a handwritten
or AI-written GET that inserts was invisible until runtime. The framework-owned SSO GET/ACS
pair (D-120) and the email-verification link GET (D-156) are the protocol-driven write paths;
an application route must not add another one.

**Decision.** Check GET side-effect freedom statically as analyzer diagnostic
`route-get-side-effect` and AI validator rule 21 `get-side-effect-free` (error), reusing the
D-157 route-relations walk instead of a second walker. A write the walk can prove is an
error; a handler body it cannot fully inspect is a warning, never a guessed error. Two
separate pinned exemption lists, each entry with a one-line why, cover the framework
protocol write GETs (SSO, email verification) and the framework read-only blueprint GETs.
Additive: no runtime boundary changes.

**Mechanism.**

- The route-relations walk records write sites additively: `RouteRelationsFact.writes`
  (insert/update/delete on `ctx.db`), `RouteElevationUsage.writes` (inside an audited
  `ctx.sudo`/`ctx.system` callback) and `jobEnqueues` (`ctx.jobs.enqueue`/`cancel`).
  `db.execute` sites were already recorded as `rawSql`. The `ctx.jobs` handle is tracked
  like the service handles (a `DbClient.jobs` marker), so forwarding it into a project-local
  helper is followed; a queue mutation belongs to the route even inside an elevation, because
  `ctx.jobs` is bound to the request transaction (D-107).
- A valid wrapper whose handler body cannot be inspected now keeps `relations.opaque = true`
  (previously an explicitly empty usage), so "unreadable" stays distinguishable from
  "read-only". This also suppresses rule 18's declared-but-unused warning for such routes,
  matching its existing opaque suppression.
- The new pass `route-get-effects.ts` reads those facts for GET and method-less (ALL) routes
  with a valid wrapper: proven write sites are errors; otherwise an opaque body warns.
  `routeGetSideEffects` is shared with the AI rule so both agree; pre-D-212 IDE snapshots lack
  the new fields, hence the `?? []` fallbacks.
- Validator rule 21 consumes the effective post-patch Analysis (overlay facts, never
  re-parsed patch text) and covers every effective GET-like route, so a patch that turns a
  shared helper into a write re-checks the untouched routes that call it.
- `FRAMEWORK_GET_WRITE_EXEMPTIONS` has two entries, each matching an exact path or a path
  prefix: `/api/auth/sso/` (D-120: the start GET creates the single-use state and the callback
  GET completes login; the SAML ACS is a POST) and the exact path `/api/auth/verify-email`
  (D-156: the single-use link is consumed before a session exists; the token is the
  credential). Exact-path matching keeps `/api/auth/verify-email-other` an app route.
  packages/nitro's own routes are not project route files and are never scanned.
- `FRAMEWORK_GET_READ_EXEMPTIONS` is a **separate** list of exact paths for framework-
  guaranteed read-only blueprint surfaces whose bodies are opaque to the walk (a framework
  primitive receives the client): `/api/auth/clients` (D-142/D-156: `listApiClients` is a
  read-only projection, the secret hash never leaves the server) and `/api/files/{id}`
  (D-053: `sendStoredFile` verifies the signed token and streams the blob, no write). Both
  routes are pinned by `ide/src/facilis/starter-contract.test.ts`; the paths use the
  file-router's OpenAPI segment form (`index` popped, `[id]` rendered `{id}`). It is kept
  distinct from the write list because these are reads, not protocol write paths, and it
  exists so the shipped apps boot with zero analyzer warnings (D-199 precedent, the
  `ide:smoke` manifest contract). Exact-path matching keeps `/api/auth/clients-extra` and
  `/api/files/{id}/extra` app routes.
- `routes-gate.test.ts` runs the check over `examples/` and `starter/` and over failing and
  passing fixtures, so handwritten GETs fail `pnpm test` like handwritten routes do.

**Rejected.** A separate GET walker duplicating the helper-following machinery: it would
drift from D-157. Treating `db.execute` with `rawSql: true` as read-only: the SQL may write,
so the check fails closed. Guessing an error on an opaque body: the unknown convention warns.
A config allowlist of writing GETs: allowlists fail open for the next route (D-136). Checking
HEAD: it is not a top-level navigation vector.

**Consequences.** Additive: the runtime origin gate and the D-157 declaration errors are
unchanged; rollback is removing the pass/rule/gate and the SPEC row. The shipped todo-app
`verify-email` GET (D-156) is a pinned exemption, so it neither errors nor warns; no shipped
example has a proven GET write, and every shipped app boots with zero GET warnings (the
`ide:smoke` manifest contract, asserted by `routes-gate.test.ts`). Accepted tradeoff: an app
that edits its own copy of a pinned blueprint route keeps the exemption (the same tradeoff
class as the SSO/verify-email pins); the runtime remains the authority, and the reserved-
route-prefix child (#173) will later forbid app routes shadowing framework paths. The
validator is now 21 rules; the SPEC §9.3 table, the guide and the prompt carry the count.

**Verification.** `packages/analyze/src/passes/route-get-effects.test.ts` (direct/helper/
elevation writes, queue mutations, read-only pass, SSO exemption, opaque and unreadable-body
warnings, ALL coverage, write and read-only exemptions with near-miss paths asserted against
`routeLocationFromFile`), `packages/ai/src/validator-get-side-effects.test.ts` (rule 21 error/
warning/exemption paths and the shared-helper re-check), the `routes-gate.test.ts` GET
fixtures and the zero-GET-warning assertion over the shipped apps, plus `pnpm lint`/
`typecheck` and the targeted analyze/ai test suites.
