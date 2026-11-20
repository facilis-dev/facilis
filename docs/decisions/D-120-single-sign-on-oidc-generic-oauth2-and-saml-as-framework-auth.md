# D-120 — Single sign-on: OIDC, generic OAuth2 and SAML as framework auth

**Status:** accepted (2026-11-08)

The owner asked for single sign-on (OIDC / SAML / OAuth2) as the second and final missing
feature. Facilis already owns the session, RBAC, users and roles (SPEC §5.3): a password login is
an app route blueprint, sessions are opaque rows and every request is tenant-scoped. SSO belongs
in that same subsystem — not in each generated app — so the flows cannot drift or be implemented
insecurely per project.

**Decision.**

- **Configuration is code, secrets are environment.** `auth.sso.providers` is a discriminated
  union on `kind` (`oidc`, `oauth2`, `saml`): id, label, discovery/manual endpoints, client
  id, scopes, mapping, `autoProvision` and an optional `defaultRole`. A secret is named by the
  ENV VAR ( `clientSecretEnv` / `certificateEnv`), never stored in the config. `defineConfig`
  validates ids (URL-safe and unique), URLs, `defaultRole` against `auth.roles`, token auth mode
  and redirect paths eagerly, so a broken provider fails at boot, not at first login.
  `auth.sso` adds `failureRedirect` (same-origin path, default `/login`) and `stateTtlMs`
  (default ten minutes).
- **Framework-owned routes, one handler.** `/api/auth/sso/**` is registered by `@facilis.dev/nitro`
  in dev and production alike and handled by one `defineAuthorizedHandler` with
  `permission: []`: `GET /api/auth/sso/providers` (`{ providers: [{ id, label, kind,
  startUrl }] }`, no secrets), `GET /api/auth/sso/:provider/start` (302 to the IdP) and
  `GET|POST /api/auth/sso/:provider/callback` (302 back to `redirectTo` or to the failure
  redirect with `?sso_error=<code>`). A provider whose secret/certificate env var is missing is
  hidden from the list and answered with `sso_provider_unavailable`. App-owned login/register
  routes are unchanged; the namespace is reserved by the framework and documented in SPEC §5.3.
- **OIDC** is authorization code + PKCE (S256) + nonce + single-use state; discovery is fetched
  from `<issuer>/.well-known/openid-configuration` and cached per provider; the ID token is
  verified with `jose` (JWKS, issuer, audience = client id, nonce, expiry), with a userinfo
  fallback only when the email claim is missing. `client_secret_post`, `client_secret_basic` and
  public-client `none` are supported.
- **Generic OAuth2** uses explicit authorization/token/userinfo endpoints and a dotted-path
  mapping (`subject`/`email`/`emailVerified`) for the userinfo JSON, with the same
  authorization-code + PKCE S256 flow (sent unconditionally; a provider that does not implement
  PKCE ignores the unknown parameters per RFC 6749, while a public `tokenAuth: "none"` client is
  protected). Email verification is claim-driven; a provider that never reports it must opt in
  with `assumeEmailVerified`.
- **SAML** is SP-initiated Web Browser SSO: an `AuthnRequest` built by the framework
  (HTTP-Redirect binding, deflate+base64, unique request id, ACS URL, audience/issuer) and an
  HTTP-POST ACS. Assertions are validated by `@node-saml/node-saml`, imported **lazily** inside the
  SAML path so a project that does not use SAML never loads it at runtime; a production server
  build may still emit it as a separate on-demand chunk, and the WebContainer dev path only
  reads it from node_modules if SAML is actually configured.
  `wantAssertionsSigned` defaults to true (response signing is opt-in), clock skew is 5 seconds,
  and InResponseTo is checked when present in addition to the single-use RelayState. IdP-initiated
  SSO is not accepted (no unsolicited assertion surface).
- **Account linking is conservative.** The identity key is `(provider, subject)`, so a changed
  email never breaks the link. Without an identity, an email must be **verified** and is matched
  against `users`: an existing user gets the identity linked; otherwise `autoProvision` (default
  true) creates the user with a null password hash and the provider's `defaultRole` or
  `auth.defaultRole`. Unverified email never links or provisions (`sso_email_unverified`), and
  `autoProvision: false` refuses unknown users (`sso_account_not_found`). Writes to
  `users`/`user_roles`/`auth_identities`/`auth_sso_states` run only inside the audited
  `ctx.system` elevation, never on a raw client; the session is created with the framework's
  `createSession` and the cookie helper, exactly like a password login.
- **Tables.** `auth_identities` (`(provider, subject)` PK, user id, email, tenant, timestamps) and
  `auth_sso_states` (single-use state, provider, nonce, PKCE verifier, SAML request id, redirect,
  expiry, tenant) live in `@facilis.dev/auth` with the standard restrictive tenant RLS plus a
  permissive tenant-scope policy; the project ships the generated migration.
- **Audit and privacy.** `ctx.log.audit` records `auth:sso:start`, `auth:sso:login`,
  `auth:sso:link` and `auth:sso:provision` with the provider id and outcome only. Tokens,
  authorization codes, SAML payloads and email addresses are never logged (D-119's redaction is
  the second line of defence).
- **Public origin.** The callback/ACS URL is derived from `FACILIS_PUBLIC_ORIGIN` when set,
  otherwise from the request origin; a deploy behind a proxy must set the variable and register
  `https://<origin>/api/auth/sso/<provider>/callback` at the IdP. `redirectTo` is restricted to
  same-origin paths (no `//`, no backslash), which closes the open-redirect hole.

**Rejected alternatives.** *Per-app SSO route blueprints*: every generated project would
reimplement state/PKCE/signature checks, and a bug would be a vulnerability. *Secrets in
`facilis.config.ts`*: the config is committed. *Hand-rolled XML signature verification*: XML
canonicalization is precisely where SAML implementations get broken; node-saml is maintained and
only loaded when needed. *IdP-initiated SAML*: it removes the request binding and turns the ACS
into an unsolicited-assertion endpoint. *Auto-linking unverified emails*: an account-takeover
primitive. *Leaving SSO to the app's own OAuth client for Git*: D-082's device flow is scoped to
Git operations and never creates a Facilis session. *A static `@node-saml` import*: it would
pull a CJS crypto tree into every project's in-VM bundle, including projects with no SAML.

**Consequences.** Projects without `auth.sso.providers` are byte-for-byte unaffected (empty
`providers` is the default). A project enabling SSO needs its DB, the secret/cert env vars and
the callback URL registered at the IdP. SAML adds `@node-saml/node-saml` (and its tree) to
the generated project's install; the import is lazy, so boots and non-SAML logins do not touch
it. Passkeys, TOTP/2FA, SCIM provisioning and token refresh are explicitly out of scope (O-020).

**Verification.** `@facilis.dev/auth` SSO tests: config/provider resolution (hidden when a secret is
missing, public list shape), state single-use/expiry and redirect guard, PKCE/challenge and
authorize URLs, OIDC ID-token verification against a local JWKS (valid, wrong nonce, wrong
audience, expired), OAuth2 mapping and emailVerified policy, identity rules (existing identity,
link by email, provision, autoProvision off, unverified email, role assignment), SAML request
generation and ACS rejection (tampered/unsigned), audit entries without secrets. `@facilis.dev/nitro`:
the route dispatch (providers, start 302, callback 302 + cookie, unknown path 404, SAML POST body
validation) with an injected fetch. The example app migration/schema and the login page are
covered by the starter contract; a real-IdP checklist is in `docs/SSO.md`.
