# Security audit — Facilis (HEAD 69985e4, 2026-11-10)

Static security analysis of the repository, with the SPEC as the contract (SPEC §8, §9.3, §11.4)
and verification of the recent decisions (D-136, D-137, D-141, D-142, D-143, D-098, D-099, D-119, D-120).
No code changes: this document is the only artifact produced.

**Scope:** `packages/{core,db,auth,nitro,storage,ai,analyze}`, `ide/src`, `examples/todo-app/server`,
`scripts/dev`, `.github`, `ide/public/sw.js`, root configs and deployment documentation.
**Excluded:** `vendor/vivari` (read-only upstream submodule; `ide/public/sw.js` is the synchronized
copy with the IDE patch and was read as such), dependency CVE scanning (no network access),
dynamic/exploit testing (static verification on the code only).

## 0. Executive summary

The defense model is above average for a low-code framework: structural RBAC in the wrapper,
RLS as the *grant* boundary (D-136), fail-closed audited elevations, the AI validator, log
redaction, signed download tokens. The main problems are not in the "inline" guards but in
**three unverified assumptions**: (a) that an email belongs to whoever registers it, (b) that
`NODE_ENV` is always set in production, (c) that the security boundary is always the *user*
when some RLS policies scope only the *tenant*.

| ID | Finding | Severity | Confidence | Area |
|---|---|---|---|---|
| SEC-01 | First-admin bootstrap hijackable via unverified email (including case variants) — resolved with a one-time token (D-150) | **Critical** | High | auth/bootstrap |
| SEC-02 | SSO linking onto accounts created by unverified registration → pre-hijacking — resolved at the root with email verification and the pending-account claim (D-156) | **High** | High | auth/SSO |
| SEC-03 | Fail-open production detection: with `NODE_ENV` unset, manifest, dev/query, dev/schema, dev/view stay open and cookies lack `Secure` | **High** | Medium | nitro/deploy |
| SEC-04 | No rate limit/lockout on login and registration; enumerable registration (409 with detail) — per-route throttle (D-152), generic response, timing D-148 | **High** | High | auth |
| SEC-06 | RLS on `sessions`/`user_roles`/`api_clients`/`api_tokens`/`auth_identities` is tenant-wide, not per-user | Medium | High | DB/RLS |
| SEC-07 | SAML: `validateInResponseTo: "ifPresent"` accepts assertions without `InResponseTo` (contract: no unsolicited responses) | Medium | Medium | SSO |
| SEC-08 | Token endpoint rate limiter: attacker-chosen key, unbounded map, poisonable quota | Medium | High | API/client |
| SEC-09 | No body size limit before parsing (JSON and multipart) — resolved with a cap in the wrapper (D-153) | Medium | High | HTTP/DoS |
| SEC-10 | "open" profile: same-origin preview iframe with `allow-same-origin` → project code reads the AI key in localStorage — **open**, deferred to an IDE feature (D-155) | Medium | High | IDE |
| SEC-11 | PBKDF2 at 210k iterations (< OWASP recommendation) and a timing oracle on email existence | Low | High | auth |
| SEC-12 | Invariants 1/2 (wrapper and accurate dbTables) not blocking for hand-written code: analyzer diagnostics only — resolved with a CI gate (D-154) | Low | High | process |
| SEC-13 | Job queue without ownership: `input`/`output` readable by anyone with the route's permission (resolved with `jobs:read`/`jobs:exec` in RLS, D-145) | Low | High | jobs |
| SEC-14 | Self-certified `dbTables` and elevations: nothing verified the relations actually queried (arbitrary route RLS; elevations with a misleading audit) — resolved with static analysis + a runtime guard and AI rule 18 (D-157) | Medium | High | DB/route |

**Status as of 2026-11-11 (hardening complete):** resolved SEC-01 (D-150), SEC-02 (email
verification and the pending-account claim, D-156; D-151 is superseded), SEC-03 (D-146), SEC-04
(D-148 timing/PBKDF2 + D-152 per-route throttle, generic registration response; an indirect
enumeration channel remains, mitigated by the rate limit), SEC-07 (D-147), SEC-08 (D-149),
SEC-09 (D-153), SEC-11 (D-148), SEC-12 (D-154), SEC-13 (D-145); SEC-06 mitigated (session
hashing, D-144). Only **SEC-10** remains open, deferred to a dedicated IDE feature (D-155)
because changing the preview sandbox touches cookies/storage/Service Worker and must be
verified in the browser.

Totals: 1 critical, 3 high, 5 medium, 3 low. **SEC-05 was withdrawn** after review: a
`crossSite` route is also usable by the logged-in user with roles, so accepting the cookie for
same-origin calls is the intended behavior (only the note in §3 remains). No unauthenticated
remote bypass was found in the framework-owned routes (/api/auth/token, SSO, manifest, dev);
the most concrete paths go through the blueprint application routes (login/register) and
deployment configurations.

## 1. Finding details

### SEC-01 — First-admin bootstrap hijackable via unverified email — Critical, high confidence

**Status (2026-11-10): resolved — D-150.** Promotion requires the one-time token
`FACILIS_INITIAL_ADMIN_TOKEN` in addition to the email, the comparison is constant-time, the
bootstrap is one-time (no existing admin) and emails are canonical with a unique `lower(email)`
index. Registration answers `{ accepted: true }` without a role or id. Verification:
`seed.test.ts`, `migrations.test.ts`, the auth/core/examples suites.

**Evidence.**
- `examples/todo-app/server/routes/api/auth/register.post.ts:57-61` — registration is public
  (`permission: []`), does not prove ownership of the email and calls
  `registerInitialAdmin(systemDb, user.id)`.
- `packages/auth/src/seed.ts:62-77` — promotes to `admin` the user whose address, **compared in
  lowercase**, matches `FACILIS_INITIAL_ADMIN`.
- `packages/auth/src/tables.ts:37` — `email: text("email").notNull().unique()`: uniqueness is
  **case-sensitive** (no index on `lower(email)`).
- The flow is the one documented as the official bootstrap: SPEC §8.4.3 (lines 1891-1912),
  `examples/todo-app/README.md:46`, `docs/DEMO.md:32`.

**Attack path.** With a deployment that follows the documentation
(`FACILIS_INITIAL_ADMIN=founder@azienda.it`) and the blueprint's registration route exposed:
1. any unauthenticated user registers `founder@azienda.it` **before** the real founder (or a
   case variant, e.g. `Founder@azienda.it`, which passes the `unique` constraint because it is
   case-sensitive);
2. the registration response shows `role: "admin"`; the subsequent login obtains the role with
   the `*` wildcard (all permissions, including the `api-clients:*`, `users:*` routes);
3. even if the real founder registers later, the attacker keeps `admin`. Owning the mailbox is
   not required: no email-verification check exists in the framework.

**Why the current controls are not enough.** Registration goes through the wrapper (Zod, origin
gate, audit) and the `system` elevation is correct, but the *criterion* for promotion is an
unverified identity; the case-insensitive comparison makes it worse (bypass even at a distance
in time). The case-sensitive uniqueness constraint allows duplicate accounts with different
casing.

**Remedy.** Do not promote by email: use a one-time bootstrap token (env) consumed at the first
registration, or a CLI/migration promotion with DB access; alternatively require email
verification before promotion. Normalize the email (lowercase) at registration/login and add a
unique index on `lower(email)`. Negative test: registering a case variant of
`FACILIS_INITIAL_ADMIN` must not produce `admin`.

### SEC-02 — SSO: linking onto an account whose email was never verified → account pre-hijacking — High, high confidence

**Status (2026-11-10): resolved at the root — D-156 (supersedes D-151).** The framework now
verifies password accounts: `users.email_verified_at` + a one-time link in
`auth_email_verifications`, login `403 email_unverified` until verified, and public
registration cannot be used to "reserve" an address (a pending account is claimed by
re-registering the email and is verified by the link). SSO linking follows verification: a
verified account links, a pending account is claimed by the identity with the placeholder
password removed — the attacker who registered the address first loses the account, the victim
keeps it. Verification: `identity-guard.test.ts`, `email-verification.test.ts`,
`migrations.test.ts`.

**Evidence.**
- `packages/auth/src/sso/identity.ts:121-140` — without a linked identity, an `emailVerified`
  email is matched against `users.email` (`findUserIdByEmail`, line 67) and, if a user exists,
  the SSO identity is **linked** to that account.
- `packages/auth/src/sso/identity.ts:125` — the "unverified email never links" check protects
  only the provider's claim, not the fact that the existing account was created without
  verification.
- `examples/todo-app/server/routes/api/auth/register.post.ts:10-14` — password registration has
  no email verification (and the framework does not offer it: no `emailVerified` field on
  `users`).
- D-120 explicitly assumes "an email must be verified and is matched against users" for linking.

**Attack path.** In a deployment with SSO enabled (`autoProvision` default `true`) and password
registration:
1. the attacker registers `vittima@azienda.it` with a password they know;
2. the victim does their first SSO login with the company email verified by the provider;
3. the flow links it to the account the attacker created; the victim works in an account whose
   password the attacker knows (and can read/modify everything, or use it for internal phishing).

This is the "account pre-hijacking" class: the D-120 check protects the SSO claim, not the
pre-existing account.

**Remedy.** Add real email verification (field + token) and refuse SSO linking to an account
with `passwordHash != null` and an unverified email; or restrict linking to users created by
SSO or invited by an admin; log the linking event with a notification. Minimal alternative: in
the registration blueprint require an invitation or the bootstrap token (SEC-01).

### SEC-03 — Fail-open production detection (`NODE_ENV`) — High, medium confidence
**Status (2026-11-10): resolved — D-146.** Only `development`/`test` are dev; unset and unknown
values are production (dev endpoints 404, `Secure` cookies, no PGlite).

**Evidence.**
- `packages/nitro/src/runtime/env.ts:9` — `return environment["NODE_ENV"] === "production"`:
  *only* the exact string disables the dev endpoints; an absent value counts as "development".
- `packages/nitro/src/runtime/http-guard.ts:43-48` — `guardDevRequest` answers 404 only if
  `isProductionEnvironment()` is true; otherwise it applies only the origin allowlist.
- `packages/nitro/src/runtime/http-guard.ts:17-33` — if `Origin` is absent the request passes
  (non-browser clients like `curl` always pass).
- `packages/nitro/src/session-cookie.ts:53` — `secure: options.secure ?? process.env.NODE_ENV === "production"`:
  without `NODE_ENV` the session cookie has no `Secure`.
- The requirement is documentary only: `docs/POSTGRES.md:110,151` use `NODE_ENV=production`
  in the startup example, but nothing in the code enforces it.

**Impact in a deployment that omits `NODE_ENV` (Docker/systemd/process manager, self-host):**
- `/__facilis/manifest` answers 200 without authentication: the full manifest (config, roles and
  permissions, routes, schema, metadata) to anyone who reaches the network, even without `Origin`;
- `/__facilis/dev/schema` and `/__facilis/dev/query` stay active: "read-only" SQL queries executed
  on the root connection (in a deployment connected as owner/superuser this bypasses RLS; with
  superuser, file reads via functions like `pg_read_file` are also possible);
- `/__facilis/dev/view` allows creating definer views with a declared permission;
- session cookies without `Secure` (sent over HTTP, if the site is reachable in cleartext);
- the log sink goes to project files instead of stdout (a trail outside the operator's control).

**Remedy.** Invert the default: treat only an explicit value as dev
(`FACILIS_ENV=development` or `NODE_ENV in {development,test}`), so the absence of configuration
fails closed; test `guardDevRequest({})` → 404. Require `DATABASE_URL`/`FACILIS_STORAGE_SECRET`
in production and refuse to boot otherwise.

### SEC-04 — No throttling on login/registration, enumerable registration — High, high confidence
**Status (2026-11-10): mitigated — D-148, D-152, D-156.** Constant-time login (dummy hash),
PBKDF2 600k and a per-route throttle in the wrapper (login 10/min, registration 5/min per
client); registration answers `{ accepted: true }` without details and email verification
(D-156) makes unverified accounts unusable. An indirect enumeration channel remains
(registration → login: a verified account answers `unauthorized`, a pending one
`email_unverified`), mitigated by the rate limit; it closes with "deferred" registration (the
user is created only after verification), deferred as an evolution in D-156.

**Evidence.**
- The only rate limit in the repo is for `/api/auth/token`: `packages/nitro/src/routes/token.post.ts:44`,
  `packages/nitro/src/runtime/rate-limit.ts`; no limiter exists for application routes.
- `examples/todo-app/server/routes/api/auth/login.post.ts:16-33` — no lockout/backoff; every
  attempt runs PBKDF2 (210k) and the response is identical, but...
- `examples/todo-app/server/routes/api/auth/login.post.ts:26-30` — if the email does not exist
  it returns **before** `verifyPassword`: a timing oracle for account enumeration.
- `examples/todo-app/server/routes/api/auth/register.post.ts:24-27` — for an already registered
  email it answers `409 conflict` with `details { email: "already_registered" }`: direct and
  reliable enumeration.

**Attack path.** Unlimited credential stuffing/brute force on login (PBKDF2 makes each attempt
expensive but does not prevent volume); enumeration of registered emails via login timing or
via the registration 409; unlimited account creation (spam, squatting future emails, see
SEC-01/SEC-02). The blueprint routes are the code users copy into their projects.

**Remedy.** Make the rate limit a wrapper capability (`defineAuthorizedHandler({ rateLimit })`)
with an (IP, route) key and different thresholds for login/register/token; a generic response
for duplicate registration too (or 202 with email verification); run a "dummy" PBKDF2 when the
user does not exist to equalize timing. The in-memory limiter is fine only for single-instance:
document it.

### SEC-05 — Withdrawn in review (not a finding)

At the owner's direction: a `crossSite` route is an API that must also be usable by the
logged-in user with permissions; the session cookie for same-origin calls is therefore
intentional. Cross-site exposure remains delegated to Bearer (D-142) and the "cookie never
cross-site" guarantee is `SameSite=Lax`. This is not a vulnerability in the intended model; the
only theoretical residual (noted in §3): if a deployment ever hosts untrusted applications on
*same-site* subdomains of the same registrable domain, a POST with the cookie on a `crossSite`
route would not be stopped by the origin gate. No action required today.

### SEC-06 — The RLS policies of the credential tables are tenant-wide: sudo is not needed — Medium, high confidence (verified with a test)

**Status (2026-11-10):** partially mitigated — the hashing solution for session ids is
implemented (D-144): the `sessions` row contains `sha256(cookie)` and is no longer reproducible
as a credential. The tenant-wide visibility of the rows (user→sessions) and the question of
`user_roles` writes remain; the system-only solution stays the alternative if that too must go.

**Direct answer to the question:** no, it is not readable "only by the system identity or using
sudo". The tables in question are **app-scoped** (D-136): `ensureAppRole` grants DML to
`facilis_app` on every table with RLS enabled (`packages/db/src/policy.ts:94-111`), and
`sessions` has RLS enabled (`packages/auth/src/tables.ts:71-78`). So any `ctx.db` — without
sudo, without a system role — can read those rows; `sudo`/system are only needed to *bypass*
RLS, not to read them. The point is not the role: it is that the policy contains **neither** a
per-user filter **nor** a per-role filter.

**Evidence.**
- `packages/auth/src/tables.ts:63-66` — `parentUserAccessPolicy`: `exists (select 1 from users u where u.id = <col>)`,
  no comparison with `app.user_id`.
- `packages/auth/src/tables.ts:49-53` — the policy on `users` is tenant-only (restrictive
  `tenant_isolation` + permissive `users_tenant_access`): the EXISTS is true for every user of
  the tenant.
- Applied to `sessions` (`:77`), `user_roles` (`:110`), `api_clients` (`:139`),
  `api_tokens` (`:159`); the same pattern for `auth_identities` in `packages/auth/src/sso/tables.ts:36-41`.
- The session id is **the cookie value**, stored in cleartext as the PK
  (`packages/auth/src/session.ts:24-45`): a SELECT on `sessions` returns live credentials.

**Empirical verification (executed, temporary test then removed).** With `createAuthTestDb()`
(PGlite + real policies) and two users A/B of the same tenant, a read executed with
`runWithPolicyScope(db, { tenantId, userId: A })` — i.e. the `facilis_app` identity and A's
scope, exactly what a handler receives — returns **both** sessions:

```
VISIBLE_SESSIONS [{"id":"session-user-a","userId":"1111…"},{"id":"session-user-b","userId":"2222…"}]
```

The same outcome for `user_roles` and the other tables with the same pattern: visibility is the
tenant's, not the user's. Today no framework-owned route exposes `sessions` (the only reader is
`validateSession`, which filters by id), so the impact requires an application route or the
(dev) Data Explorer querying those tables, or a filter bug in a handler; but the declared
boundary ("inherits the parent user's visibility") is not what the policy implements.

**Why "add `app.user_id` to the policy" is not enough (correction).** The session middleware
validates the cookie **before** knowing the user: its transaction has only `{ tenantId }`
(`packages/auth/src/session.ts:151-165`), so a policy on `sessions` demanding
`user_id = app.user_id` would block login. The same constraint for `loadUserRoles`.
The real options:
1. **Hashing the session id** (recommended, low-invasiveness): the cookie stays the secret, the
   DB stores `sha256(id)` as the lookup key (`validateSession`/`destroySession` search by
   hash). The policy stays tenant-wide because the pre-auth lookup needs it, but reading the
   table no longer exposes usable credentials.
2. **`sessions` system-only** + internal lookup under elevation (like jobs, SEC-13): the grant
   is revoked from `ensureAppRole`, the middleware reads as `facilis_system` inside the
   request transaction. Careful: without RLS the `tenant_id` filter becomes the query's
   responsibility (`where users.tenant_id = ...`), so it must be centralized in one helper and
   tested; the cost is one `SET LOCAL ROLE` per request (not one audit per request).
3. **Writes**: today the `for: "all"` policy allows the app role to INSERT/UPDATE/DELETE on
   `user_roles`/`sessions` of **any** user of the tenant (role assignment included). If the
   semantics are "roles are assigned only from an audited elevation", the write policies must be
   denied to the app role and assignment moved to `ctx.sudo` (the blueprint's admin route writes
   `user_roles` with `ctx.db`: it would need adapting).
4. The `api_clients`/`api_tokens` tables expose only hashes (not usable credentials) and the
   Bearer lookup is pre-auth like the session: lower priority. `auth_sso_states` contains the
   state/`code_verifier`/nonce of in-flight logins: if it stays RLS-scoped it should be scoped
   per-user or made system-only.

### SEC-07 — SAML: assertions without `InResponseTo` accepted — Medium, medium confidence
**Status (2026-11-10): resolved — D-147.** `validateInResponseTo: "always"`: a response without
`InResponseTo` is refused.

**Evidence.**
- `packages/auth/src/sso/saml.ts:94-97` — the comment claims `ifPresent` "binds the assertion
  to the AuthnRequest"; in reality `ifPresent` means that **if `InResponseTo` is missing it is
  not verified**.
- `packages/auth/src/sso/saml.ts:141-142` — `validateInResponseTo: "ifPresent"` with a
  `cacheProvider` that contains only the attempt id.
- Contract: D-120 and SPEC §5.3 say "IdP-initiated SSO is not accepted (no unsolicited assertion
  surface)"; the residual binding is the `RelayState`, which the attacker can create themselves
  with `GET /api/auth/sso/:provider/start` (`packages/auth/src/sso/login.ts:103-117`).

**Impact.** A signed, valid assertion (correct audience/recipient) without `InResponseTo` —
typically an IdP-initiated response or a replay of an intercepted assertion — is accepted if
accompanied by a fresh attacker `RelayState`. It allows login CSRF (the victim logged into the
attacker's account) and replay within the validity window; it does not allow arbitrary
impersonation without a valid signed assertion.

**Remedy.** Use `validateInResponseTo: "always"` (or explicitly refuse a profile without a
matching `InResponseTo`) and keep the `RelayState` one-time; add a test with a SAML response
without `InResponseTo` that must fail with `sso_exchange_failed`.

### SEC-08 — Token endpoint rate limiter: attacker-controlled key and unbounded map — Medium, high confidence
**Status (2026-11-10): resolved — D-149.** FIFO map with a 4096 cap, O(1) cost per new key.

**Evidence.**
- `packages/nitro/src/routes/token.post.ts:44` — `consume(ctx.body.client_id, ...)`: the key is
  the submitted `client_id`, **before** any authentication (and the client id is declared
  public, `packages/auth/src/api-clients.ts`/D-142).
- `packages/nitro/src/runtime/rate-limit.ts:35-56` — every new key creates an entry in the
  `Map`; the sweep happens only when `size > 1024` (`:27-28`, `:60-63`) and removes only
  expired windows; distinct keys within the window grow the map without bound and every new key
  pays an O(n) sweep.

**Impact.** (1) Targeted lockout: whoever knows a client id can consume its quota and prevent
the legitimate client from obtaining tokens (application DoS). (2) Unauthenticated memory/CPU
DoS with many distinct `client_id` values, on instances with API clients enabled.

**Remedy.** Composite key (IP + client id) and a global bucket per IP/process; a bounded map
(LRU) with periodic cleanup; count unknown ids separately; keep the hash comparison constant
(already present).

### SEC-09 — No body size limit before parsing — Medium, high confidence

**Status (2026-11-10): resolved — D-153.** Cap in the wrapper before parsing (JSON 1 MiB;
multipart `storage.maxUploadBytes + 1 MiB`), a `content-length` pre-check, a streaming counter
with reader cancellation, a new `payload_too_large` code (413) in registry/locale/blueprint.
Verification: `request-input.test.ts`.

**Evidence.**
- `packages/core/src/request-input.ts:83-103` — `event.req.json()` without a `content-length`
  check or cap.
- `packages/core/src/request-input.ts:119-137` — `event.req.formData()` buffers the entire
  multipart before returning the `File`s.
- `packages/nitro/src/storage.ts:61-69` — `maxUploadBytes` is checked **after** the body has
  already been read/parsed (`file.size`), and the declared size is not a consumption guarantee.

**Impact.** Memory/CPU DoS on public routes with a body (`login`, `register`, token) and on
authenticated uploads: a huge body is buffered before any refusal. In a multi-tenant deployment
it is a low-cost resource-exhaustion vector.

**Remedy.** In the wrapper: a configurable cap (default ~1 MiB for JSON, the upload size for
forms), a `content-length` check before parsing and a streaming read with a counter that aborts
past the threshold; align `storage.maxUploadBytes` with this limit.

### SEC-10 — "open" profile: same-origin preview not isolated from IDE credentials — Medium, high confidence

**Status (2026-11-10): open, deferred — D-155.** Closing it requires a product choice (a separate
preview origin by default, a preview without `allow-same-origin`, or a non-extractable AI key)
and must be verified with `pnpm ide:smoke`; it was not touched in this PR to avoid breaking the
preview's storage/cookies/Service Worker without browser coverage. The residual risk remains the
one documented in D-063.

**Evidence.**
- `ide/src/vv/preview-sandbox.ts:10-17` — without `VITE_PREVIEW_ORIGIN`/`VITE_PREVIEW_WILDCARD_DOMAIN`
  (open profile, default) the iframe sandbox is
  `allow-scripts allow-same-origin allow-forms allow-popups allow-modals`: project code shares
  the IDE's origin.
- `ide/src/components/ide/PreviewPanel.tsx:112` — `sandbox={previewSandbox(hasSeparatePreviewOrigin)}`.
- `ide/src/ai/settings.ts:10-14` — the AI provider's API key is in cleartext in
  `localStorage("vv-ai-settings")` (a choice accepted in D-045); `ide/src/ai/mcp/mcp-config.ts`
  does the same for MCP tokens. OPFS contains the projects of all tabs.
- `ide/public/sw.js` and the preview bridge have `postMessage(..., "*")` messages but with a
  host-side origin check: in same-origin the check passes by definition.

**Impact.** Project code (including AI-written code, potentially influenced by prompt injection
or by project dependencies) runs same-origin with the IDE: it can read the provider API key and
MCP tokens from `localStorage`, the OPFS with the projects, and use the Service Worker bridge.
In the managed profile (preview on a separate origin) this does not happen. A documented
residual risk (D-063) but a relevant one, because the code is untrusted by construction.

**Remedy.** Make the separate origin the default in the open profile too or, if not possible,
remove `allow-same-origin` (accepting the loss of preview cookies/storage) and keep the AI key
in a context the frame cannot read (worker/non-extractable crypto), clearing it while previewing
untrusted code. Document the boundary in the threat model.

### SEC-11 — PBKDF2 below the recommendation and a timing oracle — Low, high confidence
**Status (2026-11-10): resolved — D-148.** 600k iterations and a dummy hash in the login
blueprint.

**Evidence.**
- `packages/auth/src/password.ts:3-4` — `pbkdf2-sha256` with 210,000 iterations; OWASP 2023
  recommends 600,000 for PBKDF2-HMAC-SHA256. The parser accepts any iteration count between 1
  and 1M with no minimum (`:30-48`).
- `examples/todo-app/server/routes/api/auth/login.post.ts:26-30` — nonexistent user: immediate
  return without PBKDF2 → an observable time difference.

**Remedy.** Raise the default to 600k (with transparent migration at login) and a minimum in the
parser; run a dummy derivation when the user does not exist.

### SEC-12 — Invariants 1/2 entrusted to the analyzer, not to a gate — Low, high confidence

**Status (2026-11-10): resolved — D-154.** A new gate in
`packages/analyze/src/routes-gate.test.ts`: it runs the real analyzer on the routes of
`examples/` (and `starter/`) inside `pnpm test` and fails if `wrapper !== "valid"` or
`dbTables` is absent/non-static; a negative fixture proves it fires.

**Evidence.**
- AGENTS.md invariants 1-2; `packages/analyze/src/passes/routes.ts:40-74` produces the
  `wrapper: "invalid"` fact only for the IDE; the AI validator blocks it for patches
  (`packages/ai/src/rules/routes-security.ts`), but for hand-written code there is no
  enforcement.
- `package.json`: `lint` = oxlint + file-length + theme; no check scans the routes; no repo
  test fails on a route without `defineAuthorizedHandler` or with incomplete `dbTables`
  (accuracy is not fully statically verifiable, but presence and consistency with the AST are).

**Remedy.** Add a CI gate (`scripts/check-routes.mjs` or a Vitest test) that runs the analyzer on
`examples` and the fixtures and fails on `wrapper != valid` / `dbTables == null`; optionally an
oxlint rule for the route default export.

### SEC-13 — Job queue without ownership: what it means concretely — Low, high confidence

**The model.** The queue is framework state, not application data: `facilis_jobs` has the columns
`id, name, status, input, output, error, attempts, …` and **a single scope column, `tenant_id`**
(`packages/db/src/jobs.ts:30-61`). The policy is `facilis_jobs_tenant_access`:
`using (nullif(current_setting('app.tenant_id', true), '') is not null)`. There is no
`owner_id`, and no policy names `app.user_id` or `app.roles`: the only permission protecting a
job is the **route's permission** that exposes it, not the row.

**The path through the code (why the user filter is absent).**
1. In the wrapper, `ctx.jobs` is bound to the request transaction:
   `const requestJobs = jobs.bindScope?.(db) ?? jobs` (`packages/core/src/route.ts:229`).
2. `bindScope` builds the store with that scope
   (`packages/nitro/src/runtime/jobs/runtime.ts:77-80`); every operation does
   `runWithPolicyScope(db, { tenantId }, fn)` or uses the request scope directly
   (`packages/nitro/src/runtime/jobs/db-store.ts:49-51`).
3. `get(id)` is `select * from facilis_jobs where id = $1` (`db-store.ts:69-75`); `list()`
   filters only by `status`/`name` (`db-store.ts:77-96`); `cancel()` updates by id. None of
   these queries adds `user_id`.
4. `toJobRecord` returns **`input` and `output`** (and `error`) to the caller
   (`packages/core/src/jobs.ts:171-190`; mapping in `packages/nitro/src/runtime/jobs/row-mapping.ts:16-32`).

**Practical consequence.** In a multi-user tenant, whoever holds the permission declared by the
route (e.g. `todos:read` in the blueprint) can read the payload of **any** job of the tenant,
not only their own, and with `todos:write` can cancel it — exactly the two example routes
`examples/todo-app/server/routes/api/jobs/[id].get.ts` and `[id].delete.ts`. Today the
blueprint's job payload is harmless (`{ olderThanDays }`), but a real job often carries user
data in its `input`/`output` (document ids, emails, amounts): they would become readable by
anyone with the route's permission. The ID is a random UUID, so it is not enumerable by guessing;
the concrete risk is (a) a listing route using `ctx.jobs.list()`/`queue()` — which returns all
the tenant's jobs — or (b) an ID ending up in a shared log/response. The job *body* runs as
system, but that does not change what the handler sees when it reads the queue.

**Outcome (2026-11-10, D-145): permissions instead of system-only.** System-only would have
pulled workflows and tasks into elevation too (their runner runs as `facilis_app` under the
tenant), with an audit on every queue read. The queue therefore stays RLS-scoped and is **gated
by permission at the database level**: `SELECT` requires `jobs:read`, `INSERT`/`UPDATE`/`DELETE`
require `jobs:exec` (policies on `app.permissions`, the same mechanism as views with a
permission, D-098). The engine passes the two framework permissions in its own transaction; a
request carries the session's, so a route touching the queue without the permission gets
`permission denied` from the DB. **Per-user visibility remains the endpoint's responsibility**
(no owner column): whoever implements the route filters if needed. The same pattern is planned
for `facilis_tasks`/`facilis_workflows` when they land (`tasks:read`/`tasks:decide`,
`workflows:*`). Details in D-145; migration
`examples/todo-app/db/migrations/0007_jobs_permissions.sql`; tests in `db-store.test.ts`
(scope with permissions vs scope without) and `migrations.test.ts`.

### SEC-14 — Self-certified `dbTables` and elevations: the declaration was not applied — Medium, high confidence

Invariant 2 requires `dbTables` present and accurate, but only **presence** was guaranteed (the
SEC-12/D-154 CI gate). At runtime nothing compared the declaration with the access: `ctx.db` is
the Drizzle client in the `facilis_app` transaction, and RLS is the grant boundary, not the
declaration boundary — a route declaring `["todos"]` could read `users`, `auth_identities` or
`auth_email_verifications` (all RLS with tenant-wide policies) while presenting itself to the
manifest/OpenAPI/graph as a route touching only `todos`. Inside `ctx.sudo`/`ctx.system` the
problem is worse: the callback runs as `facilis_system` with `BYPASSRLS`, so it can read any row
of any tenant, while the audit records only the **self-declared** `tables`; the security trail
was self-certified. D-136/D-137 protected only the system-only tables (no grant →
`permission denied`).

**Outcome (2026-11-11, D-157).** `dbTables` is now an applied declaration, for tables **and
views** (a view is declared by its own name, D-097/D-098):
- **static** — `@facilis.dev/analyze` resolves `defineView` into `ViewFact` and an
  interprocedural pass follows the handler into the project's functions (nested calls),
  recording `from/join`, `insert/update/delete(relation)`, `db.query.<relation>` and
  `db.execute`; it produces `route-table-undeclared`, `route-table-unused`,
  `route-table-unresolved`, `route-raw-sql` and `route-elevation-undeclared`, the CI gate
  blocks them and the AI validator has rule 18 `route-table-declared` on all effective routes;
- **runtime** — the `ctx.db` client and the elevation callbacks' client are proxied: an
  undeclared relation fails closed with `500 table_not_declared` before the query, and
  `db.execute` (non-inspectable SQL) requires `rawSql: true` on the route, otherwise
  `500 raw_sql_not_allowed`; the raw escape hatches (`$client`/`session`) are closed. The
  elevation audit records the **observed** tables (`observedTables`) alongside the declared
  ones, so the trail is no longer self-certified; `ctx.jobs` stays out (framework, D-107).

Residuals: raw SQL authorized with `rawSql` and `sql` fragments inside the builders are not
inspectable at runtime (only static analysis covers them when the fragment is in the code);
calls inside packages are opaque to static analysis (the runtime remains the authority); views
do not yet have nodes/edges in the graph (O-013, Phase 4).

## 2. Verified controls (what holds)

- **Route wrapper** (`packages/core/src/route.ts:199-213`): correct order origin → permission →
  validation → scope; 415 before reading the body; errors are codes only; no internal detail to
  the client; a single wrapper for all example routes (17/17 files).
- **RLS as the grant boundary** (`packages/db/src/policy.ts:75-112`): revocation of all app-role
  privileges, grants only to tables with `relrowsecurity`, no default privileges, `NOINHERIT`,
  `SET LOCAL ROLE` with parameterized GUCs (no value concatenation).
- **Audited elevations** (`packages/core/src/sudo.ts`, `packages/db/src/sudo.ts:71-84`):
  mandatory subset of `dbTables`, anti-nesting guard, fail-closed audit *before* the role
  change, explicit role restore (no `RESET ROLE`).
- **SSO** (`packages/auth/src/sso/state.ts:104-114`): atomic consumption `DELETE ... RETURNING`,
  expiry, token pattern, same-origin `redirectTo` without `//`/backslash/control characters;
  PKCE S256 + nonce + state; linking by `(provider, subject)`; secrets from env only; no
  secrets in logs (`identity.ts:125` refuses provider-side unverified emails).
- **Token endpoint / API client** (`packages/auth/src/api-clients.ts:181-256`): secret and token
  stored only as SHA-256, constant comparison, per-client revocation, `cache-control: no-store`,
  audit without secrets, generic 401.
- **Storage** (`packages/nitro/src/storage.ts:51-160`): HMAC signed URLs with expiry and
  tenant/file binding, fail-closed disablement in production without `FACILIS_STORAGE_SECRET`
  (`packages/nitro/src/runtime/storage-target.ts`), safe download headers (CSP `sandbox`,
  `nosniff`, `attachment`), validated content-addressed keys.
- **Logs** (`packages/nitro/src/runtime/logging/redact.ts`): per-key redaction,
  depth/size caps, no HTTP endpoint for logs, audit hash chain, fail-closed audit.
- **IDE**: no OPFS access outside the kernel (`ide/src`: only `localStorage` for preferences;
  verified with grep); git/GitHub tokens in memory only
  (`ide/src/vv/github-oauth.ts:212-223`); CDP relay with `event.origin` and
  `event.source === frame` checks (`ide/src/vv/preview-devtools.ts:121-174`); the PTC tool
  policy (`ide/src/ai/ptc/policy.ts`) that blocks `.env`/keys/`.git`/`node_modules` and
  redacts values; patches applied only after the validator (`ide/src/facilis/apply-patch.ts:72-90`).
- **Supply chain**: no secrets in tracked files or in git history (only upstream x509 fixtures
  in `vendor`); `.gitignore` covers `.env*`/`.facilis`; the `vendor/vivari` submodule pinned
  to a commit (`e654919`); CI with `permissions: contents: read`, `--frozen-lockfile`,
  submodules, pinned Node/pnpm versions; git proxy with host and header allowlists
  (`ide/git-proxy/handler.mjs`) and a `127.0.0.1` bind in the dev script.

## 3. Known accepted risks (not new findings)

- **`crossSite` routes and the session cookie (SEC-05, withdrawn):** accepting the logged-in
  user (cookie) on a `crossSite` route is the intended behavior, because the API must stay
  usable from the app with roles; cross-site exposure remains Bearer. Theoretical residual: with
  untrusted applications on *same-site* subdomains, a POST with the cookie is not stopped by the
  origin gate — to be re-evaluated only if a deployment introduces that case.
- AI provider API key and MCP tokens in cleartext `localStorage`: a choice documented in D-045
  ("nothing here is encrypted"), accepted for the browser threat model; finding SEC-10 concerns
  their reachability from project code.
- Same-origin preview in the open profile: documented behavior (D-063) — reported as a residual
  risk, not as a deviation.
- Dev endpoints active when `NODE_ENV` is not `production`: the literal semantics of SPEC
  §6.1/§8.5; the finding concerns the fail-open default, not the intention.
- IdP-initiated: D-120 explicitly says it is not accepted; SEC-07 is the implementation deviation.
- `vendor/vivari` was not audited (read-only upstream, pinned); `ide/public/sw.js` was read only
  for the contact points (bridge/preview), not line by line.

## 4. Remediation priorities

**Status as of 2026-11-11: P0/P1 complete (D-146…D-157).** The only remaining item is SEC-10 (P2,
deferred with D-155). Email verification (D-156) closed SEC-02 at the root; the possible
"deferred registration" evolution would also close SEC-04's last indirect enumeration channel.

1. **P0** — SEC-01 (admin bootstrap), SEC-02 (SSO pre-hijacking): introduce email verification or
   a token bootstrap; normalize the email. These are the two paths with the highest impact and a
   contained remedy. **(complete: D-150 for the bootstrap, D-156 for email verification and the
   SSO claim)**
2. **P0** — SEC-04 (throttling) and SEC-03 (fail-closed in production): both are framework
   capabilities, not a single project's, and protect all generated apps.
3. **P1** — SEC-06 (per-user policies on the credential tables) and SEC-07 (SAML binding):
   deviations from the written contract, with confidentiality/replay impact.
4. **P2** — SEC-08/09 (DoS), SEC-10 (preview isolation), SEC-11/12/13/14 (hardening and gates;
   SEC-13 resolved with the `jobs:read`/`jobs:exec` permissions, D-145; SEC-14 with `dbTables`
   enforcement, D-157).

## 5. Limits of the analysis

- Static analysis on commit 69985e4; no exploit execution and no dependency CVE scanning (no
  network available). For SEC-06 a temporary PGlite test was executed (then removed) confirming
  cross-user visibility of sessions; no other dynamic test.
- The framework-owned routes were read in full; the application routes only for the
  auth/file/job flows. The IDE code was sampled at the contact points with credentials, VFS and
  bridge; `vendor/vivari` is excluded.
- SEC-03's severity depends on the deployment configuration (if the platform sets
  `NODE_ENV=production`, the impact reduces to hardening); SEC-01/02 depend on exposing public
  registration, which is however the documented blueprint.
