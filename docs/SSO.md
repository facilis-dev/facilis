# Single sign-on (SSO)

Facilis owns single sign-on as framework auth (D-120, SPEC §5.3): a project declares its
providers in `facilis.config.ts`, `@facilis/auth` implements OIDC, generic OAuth2 and SAML,
and `@facilis/nitro` serves one reserved route namespace. Generated apps never reimplement
state, PKCE, token exchange or XML-signature checks.

Supported protocols:

| Kind | Flow | Identity source | Email verification |
|---|---|---|---|
| `oidc` | Authorization code + PKCE (S256) + nonce, discovery | verified ID token; userinfo fallback when the email claim is missing | `email_verified` claim, or `assumeEmailVerified` |
| `oauth2` | Authorization code + PKCE (S256), explicit endpoints | userinfo JSON mapped by dotted path | mapped claim, or `assumeEmailVerified` |
| `saml` | SP-initiated Web Browser SSO (HTTP-Redirect request, HTTP-POST ACS) | signed assertion attributes | the signed assertion itself |

Out of scope (O-020): IdP-initiated SAML, SCIM provisioning, token refresh/session sync and
second factors (TOTP, WebAuthn). Facilis SSO is password-or-SSO, not password-AND-SSO.

---

## 1. Configuration

SSO lives under `auth.sso`. Secrets are **environment variable names**, never values; the
config is committed and reviewable.

```ts
import { defineConfig } from "@facilis/core";

export default defineConfig({
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read", "todos:write"] },
    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
    sso: {
      // Where a failed start/callback sends the browser; ?sso_error=<code> is appended.
      failureRedirect: "/login",
      // Lifetime of a login attempt (state, nonce, PKCE verifier, SAML request id).
      stateTtlMs: 10 * 60 * 1000,
      providers: [
        {
          kind: "oidc",
          id: "google",
          label: "Google",
          issuer: "https://accounts.google.com",
          clientId: "1234567890.apps.googleusercontent.com",
          clientSecretEnv: "GOOGLE_OIDC_CLIENT_SECRET",
          scopes: ["openid", "email", "profile"],
          tokenAuth: "client_secret_post",
          autoProvision: true, // defaults to true
          defaultRole: "user", // defaults to auth.defaultRole
        },
        {
          kind: "oauth2",
          id: "github",
          label: "GitHub",
          authorizationEndpoint: "https://github.com/login/oauth/authorize",
          tokenEndpoint: "https://github.com/login/oauth/access_token",
          userinfoEndpoint: "https://api.github.com/user",
          clientId: "Iv1.0123456789abcdef",
          clientSecretEnv: "GITHUB_OAUTH_CLIENT_SECRET",
          scopes: ["read:user", "user:email"],
          tokenAuth: "client_secret_post",
          // Dotted paths into the userinfo JSON (a numeric id is accepted for the subject).
          mapping: { subject: "id", email: "email", emailVerified: "email_verified" },
          assumeEmailVerified: false,
        },
        {
          kind: "saml",
          id: "acme",
          label: "Acme",
          entryPoint: "https://idp.acme.example/saml/sso",
          // The SP entity id sent to the IdP; also the expected audience.
          issuer: "https://app.acme.example/saml/metadata",
          certificateEnv: "ACME_SAML_IDP_CERT",
          emailAttribute: "email", // or "nameid" to use the NameID as the address
          wantAssertionsSigned: true, // default: the assertion must be signed
          wantResponseSigned: false, // default: a signed assertion is enough
          autoProvision: true,
          defaultRole: "user",
        },
      ],
    },
  },
});
```

Validation happens in `defineConfig`: provider ids are unique URL-safe slugs, URLs are absolute
http(s), `defaultRole` (when set) must be a key of `auth.roles`, a confidential client must name
its `clientSecretEnv`, and `failureRedirect` must be a same-origin path.

### Provider fields

Every provider: `id` (URL segment), `label?` (login button; defaults to the id),
`autoProvision` (default `true`), `defaultRole?` (defaults to `auth.defaultRole`).

- **oidc**: `issuer`, `clientId`, `clientSecretEnv?` (omit for a public PKCE client with
  `tokenAuth: "none"`), `scopes` (default `["openid","email","profile"]`), `tokenAuth`
  (`client_secret_post` | `client_secret_basic` | `none`), `assumeEmailVerified` (default false).
- **oauth2**: `authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`, `clientId`,
  `clientSecretEnv?`, `scopes` (default empty), `tokenAuth`, `mapping` (`subject`, `email`,
  `emailVerified?` dotted paths), `assumeEmailVerified`.
- **saml**: `entryPoint`, `issuer` (SP entity id/audience), `certificateEnv`, `emailAttribute`
  (default `"email"`), `wantAssertionsSigned` (default true), `wantResponseSigned` (default false).

---

## 2. Routes and callback URLs

The framework registers one handler at `/api/auth/sso/**` (in dev and production alike):

| Method + path | Purpose |
|---|---|
| `GET /api/auth/sso/providers` | `200 { providers: [{ id, label, kind, startUrl }] }`, `cache-control: no-store`, no secrets |
| `GET /api/auth/sso/:provider/start?redirect=/path` | creates the single-use attempt and 302s to the IdP |
| `GET /api/auth/sso/:provider/callback?code&state` | OIDC/OAuth2 code callback; 302 to the post-login path |
| `POST /api/auth/sso/:provider/callback` | SAML ACS (`application/x-www-form-urlencoded`) |

Register this callback URL at every IdP (exactly, including scheme and host):

```
https://<public-origin>/api/auth/sso/<provider-id>/callback
```

For SAML, the same URL is the Assertion Consumer Service (HTTP-POST binding) and
`provider.issuer` is the SP entity id / expected audience. A provider whose secret or
certificate environment variable is missing is hidden from `/providers` and its start/callback
answers `sso_provider_unavailable`.

A failed start or callback is a 302 to `failureRedirect?sso_error=<code>` (appending to any
query the redirect already has). An unknown path or method is `404 { code: "not_found" }`.
Successful logins create the same opaque session as a password login: `sessions` row,
`facilis_session` cookie (HttpOnly, Path=/, SameSite=Lax, Secure in production).

The flow is a **top-level browser navigation** (the start and callback are 302s to/from the
IdP), so it works in a normal tab. In the IDE the app preview is an iframe served under
`/preview/<port>`: development SSO needs `FACILIS_PUBLIC_ORIGIN` set to
`origin + "/preview/<port>"` (the runtime keeps that base path in the callback/ACS URL) and an IdP
that accepts an `http://localhost` callback. An IdP that refuses framing (or a browser that blocks
third-party cookies) needs the preview opened in its own tab; the login page's provider buttons
then navigate top-level. This is a development-only caveat: a deployment has a normal origin and
an `https` callback.

### Public origin (proxy deployments)

The callback/ACS URL is built from `FACILIS_PUBLIC_ORIGIN` when set, otherwise from the request
origin (URL, then `Host` + `x-forwarded-proto`). A deployment behind a reverse proxy **must**
set the variable: the proxy can rewrite `Host`, and the IdP only accepts the exact redirect URI
registered for it. See [MANAGED-DEPLOYMENT.md](./MANAGED-DEPLOYMENT.md) section 5: one config is one
origin, and a managed deployment is a static site on a dedicated origin.

---

## 3. Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `<clientSecretEnv>` (provider-chosen, e.g. `GOOGLE_OIDC_CLIENT_SECRET`) | `oidc`/`oauth2` confidential clients | never committed; absent => provider hidden/unavailable |
| `<certificateEnv>` (e.g. `ACME_SAML_IDP_CERT`) | `saml` | IdP signing certificate, PEM or base64 DER |
| `FACILIS_PUBLIC_ORIGIN` | all kinds | e.g. `https://app.acme.example`; required behind a proxy |
| `FACILIS_TENANT_ID` | writes | deployment tenant for RLS (O-003); the flow inherits the request scope |

The framework never reads a secret into the config, a log line or an API response. The only
diagnostic is a warning naming the provider and the missing **ENV VAR NAME**.

---

## 4. Error codes

The browser only sees a code in `?sso_error=`; the app translates it with
`t("auth.sso.error.<code>")`.

| Code | Meaning |
|---|---|
| `sso_provider_unknown` | the path names no configured provider |
| `sso_provider_unavailable` | the provider's secret/certificate env var is missing, or discovery failed |
| `sso_state_invalid` | the attempt expired, was already used, is unknown, or the response does not match it |
| `sso_exchange_failed` | token/userinfo/SAML exchange failed, or the IdP reported an error |
| `sso_identity_invalid` | the IdP returned no usable subject/email, or a token/signature check failed |
| `sso_email_unverified` | linking/provisioning needs a verified email the provider did not assert |
| `sso_account_not_found` | `autoProvision: false` and no user matches the verified email |
| `sso_internal_error` | unexpected server failure (details are server-side only) |

---

## 5. Account linking and provisioning

The identity key is `(provider, subject)` in `auth_identities`. The subject is the IdP's stable
id (`sub` for OIDC, the mapped claim for OAuth2, the NameID for SAML), so changing an email at
the IdP never breaks the link.

A sign-in resolves as follows, entirely inside the audited `ctx.system` elevation:

1. **Existing link** - the identity row's user signs in; the row's email and `last_login_at`
   are refreshed. A later unverified email does not break an existing link.
2. **No link, verified email** - the email is matched to `users` case-insensitively. A match
   gets a new identity row (audit `auth:sso:link`).
3. **No link, no user** - with `autoProvision` the framework creates a user with a **null
   password hash**, assigns `provider.defaultRole ?? auth.defaultRole`, and writes the identity
   (audit `auth:sso:provision`). Without `autoProvision`, the login fails with
   `sso_account_not_found`.
4. **Unverified email** never links and never provisions (`sso_email_unverified`): that would be
   an account-takeover primitive.

Unique keys (`(provider, subject)`, `users.email`) plus `ON CONFLICT DO NOTHING` and a re-read
make concurrent callbacks converge on one user. Audit entries record the provider, the outcome
and the assigned role only - never tokens, codes, SAML payloads or email addresses.

---

## 6. Security notes

- **State**: 32 random bytes (base64url), stored as one `auth_sso_states` row, deleted
  atomically on use (`DELETE ... RETURNING`), expiring after `stateTtlMs`. A replayed callback
  is `sso_state_invalid`.
- **Redirect guard**: `redirect` must be a same-origin path (`/`, not `//`, no backslash,
  no control characters, <= 2048). This closes the open-redirect hole; revalidated on the way out.
- **OIDC**: authorization code + PKCE S256 + nonce. The ID token is verified with `jose` against
  the provider JWKS, issuer, audience = client id, expiry and the stored nonce; userinfo is only
  a fallback when the email claim is absent, and its `sub` must agree. Discovery is cached per
  provider with a 5-minute TTL.
- **OAuth2**: the generic flow uses the same single-use state and PKCE S256 as OIDC (the
  `code_challenge` is sent unconditionally; RFC 6749 lets a provider ignore an unknown
  parameter, so a public `tokenAuth: "none"` client is protected and a confidential one is
  unaffected). Account linking additionally needs a verified email.
- **SAML**: SP-initiated only - unsolicited/IdP-initiated assertions are not accepted, so the
  ACS is not an open assertion endpoint. `@node-saml/node-saml` is imported **lazily** inside
  the SAML path (a non-SAML project never loads it; a production server build may emit it as a
  separate on-demand chunk), validates signatures,
  recipient/audience and time windows with 5 s clock skew, and checks `InResponseTo` when the
  response carries it, bound to the stored request id through a single-use cache provider.
- **No second factor**: SSO is the credential; TOTP/WebAuthn are out of scope until a second
  credential table exists (O-020).
- **Framing**: SSO is top-level navigation. Inside the IDE preview iframe an IdP that sends
  `X-Frame-Options`/CSP `frame-ancestors` may refuse to render; open the app in its own tab
  (the preview pop-out) rather than weakening the IdP's framing policy.
- **Audit/privacy**: `auth:sso:start`, `auth:sso:login` (succeeded/failed),
  `auth:sso:link`, `auth:sso:provision`; provider id and outcome only. Request bodies and SAML
  payloads are never logged, and no log endpoint exists.

---

## 7. Real-IdP checklist

For each provider:

1. Register the exact callback URL `https://<public-origin>/api/auth/sso/<id>/callback`.
2. Set the env var(s) named by `clientSecretEnv` / `certificateEnv` in the deployment (never in
   git) and `FACILIS_PUBLIC_ORIGIN`.
3. OIDC: confirm discovery works at `<issuer>/.well-known/openid-configuration`, the client is
   allowed the `openid email profile` scopes, and the client auth mode matches `tokenAuth`.
4. OAuth2: confirm the userinfo endpoint returns the mapped subject/email and decide whether the
   provider reports `email_verified` (otherwise set `assumeEmailVerified` only for a trusted
   internal IdP).
5. SAML: register the ACS URL, set the SP entity id/audience to `provider.issuer`, map the email
   attribute, install the IdP signing certificate, and confirm whether the assertion or the whole
   response is signed (configure `wantAssertionsSigned` / `wantResponseSigned`).
6. Verify: password login still works, a first SSO login provisions the expected role, a second
   login reuses the identity, a failed login lands on `failureRedirect?sso_error=...`, and no
   secret appears in the logs or in `GET /api/auth/sso/providers`.
7. Keep the host clock synchronised: SAML windows are validated with 5 s skew.

---

## 8. Example app

`examples/todo-app` is the starter contract: `db/schema.ts` re-exports the two auth tables,
`db/migrations/0004_auth_sso.sql` creates them with RLS and tenant defaults, and
`src/pages/login.tsx` renders one button per configured provider (only when the list is
non-empty) plus the translated `?sso_error` message. The app's login/register/logout routes
write their own audit events (`auth:login`, `auth:register`, `auth:logout`) without emails or
passwords.

The test suite covers provider resolution, state single-use/expiry, the redirect guard,
PKCE/authorize URLs, OIDC ID-token verification against a local JWKS (valid, wrong nonce, wrong
audience, expired), OAuth2 mapping/email policy, identity linking/provisioning, SAML request
generation and ACS rejection (including a real unsigned response through the lazy validator),
and the route dispatch. A signed SAML fixture needs a certificate fixture that this repository
does not carry; the signed path is verified against @node-saml/node-saml on a real IdP with the
checklist above.