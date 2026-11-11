# 📘 Facilis — Full Specification

**Version:** 1.25 (dbTables enforced: tables and views, static + runtime guard, rawSql — D-157)
**Status:** Phases 0–3 complete and verified (headless + the browser harness, `pnpm ide:smoke`); the Studio (Phase 2) ships at <https://ide.facilis.dev> (D-077). Phase 4 has the AI chat, the 18-rule validator, the apply path, the §9.4 repair loop and the PTC tool runtime (the chat's only mode, D-103); the eval corpus and browser matrix remain. The live per-phase state is in [`README.md`](../README.md#status).
**Purpose:** Single source of truth for development

**Changelog:**

- v1.25 — `dbTables` è una dichiarazione applicata (D-157): ogni route dichiara tutte le relazioni che tocca, **tabelle e viste**, e il framework la verifica staticamente (analyzer con follow delle chiamate locali, gate CI, nuova regola 18 `route-table-declared`) e a runtime (guard su `ctx.db` e sulle elevazioni: `table_not_declared`, `raw_sql_not_allowed`); `rawSql: true` è l'unica deroga per `db.execute`, e l'audit delle elevazioni registra le tabelle osservate. §7.4/§8.4.6/§9.3/§11.2 follow.
- v1.24 — Email verification (D-156). `auth.verification` (default disabled) abilita il flusso: la registrazione crea l'account con `users.email_verified_at` NULL e un link monouso (token hashato in `auth_email_verifications`, TTL 24 h), il login del blueprint rifiuta `403 email_unverified` finché l'indirizzo non è verificato, e la route `GET /api/auth/verify-email` consuma il link con un redirect sicuro. La delivery è del deploy (`FACILIS_EMAIL_WEBHOOK_URL`/`_TOKEN`); in `development`/`test` senza webhook il blueprint verifica subito (demo e smoke senza casella). Il link SSO a un account password ora si basa sulla verifica: un account verificato si collega, un account pendente viene reclamato dall'identità verificata con rimozione della password segnaposto (chiude SEC-02 alla radice). §5.1/§5.3/§8.4.4/§4.4/§12 follow.
- v1.23 — Security hardening (review 2026-11-10): email canonica (`normalizeEmail`) e indice unico `lower(email)`, bootstrap del primo admin con token monouso `FACILIS_INITIAL_ADMIN_TOKEN` (D-150); link SSO verso un account password rifiutato di default (`auth.sso.linkPasswordAccounts`, D-151); throttle per route nel wrapper (`rateLimit`, chiave client address + route, D-152); cap dei byte del body prima del parsing e nuovo codice `payload_too_large` = 413 (D-153); gate CI che esegue l'analyzer sulle route di `examples/` e rifiuta wrapper non valido o `dbTables` assente (D-154). §5.1/§5.3/§7.4/§8.2/§8.4.1/§8.4.3/§8.6/§12 follow.
- v1.22 — Session id memorizzato come SHA-256 (D-144); coda gated da `jobs:read`/`jobs:exec` nelle policy RLS (D-145); rilevamento produzione fail-closed (D-146); SAML richiede `InResponseTo` (D-147); PBKDF2 600k + login a tempo costante (D-148); rate limiter del token endpoint con mappa limitata (D-149).
- v1.21 — Il token endpoint e' rate-limited (D-143). `auth.apiClients.rateLimit` (default `windowMs: 60000`, `maxRequests: 30`) limita gli scambi per client id in una finestra fissa in-process; oltre il budget la route risponde `429 too_many_requests` (nuovo codice della registry chiusa O-002) con `retry-after`, prima di toccare il database, e audita il tentativo. La revoca resta per client: un client revocato invalida client e token in una transazione e non esiste revoca per singolo token. §7.1/§7.4/§8.6 follow.
- v1.20 — External APIs (D-142). `auth.apiClients` (default disabled) exposes the framework-owned `POST /api/auth/token` (OAuth2 `client_credentials`, JSON body, no refresh token: renewal is a new grant); the access token is opaque and stored as a SHA-256 hash, and `Authorization: Bearer` resolves to a **service account** (`users.isService`, a role fixed on the client) in the session middleware. A service account can never log in: `validateSession` refuses it, `createSession` throws, SSO does not link it and the template login route rejects it. `crossSite: true` with a non-empty `permission` is now legal (it is reachable only with a Bearer token) and publishes `x-cross-site` + OpenAPI `security: [{ bearerAuth: [] }]`; `originCheck: "skip"` is the protocol-only exemption (SAML ACS). §5.3/§6.9/§7.1/§7.3/§7.4/§8.2/§8.4.4/§8.6 follow.
- v1.19 — CSRF is structural (D-141). `defineAuthorizedHandler` rejects an unsafe cross-site request with `403 forbidden` before the permission check (`Sec-Fetch-Site` authoritative, `Origin`/`Host` fallback; a missing `Origin` is a non-browser client) and a `body`/`form` route accepts only `application/json`/`multipart/form-data` (`415 unsupported_media_type`, a new code in the closed registry), so `SameSite=Lax` is defense in depth rather than the only barrier. `config.security.trustedOrigins` (default `[]`) allow-lists a same-site SPA/API split; `crossSite: true` declares a public route exposed to other origins and is propagated as `RouteMeta.crossSite`/`x-cross-site`, with a Nitro middleware answering CORS preflight — it is an exposure declaration, not a CSRF defense. §7.1/§7.3/§7.4/§8.2/§8.6 follow.
- v1.18 — System-only is a class, not a defect (D-137). The project graph and the Data Explorer label a table without RLS **system-only** in a neutral colour (the amber "no RLS" badge is gone; the red "RLS off on scoped table" stays), and `@facilis/analyze` warns `route-system-table` when a route declares a system-only table in `dbTables`/`dbColumns` outside an audited `ctx.sudo`/`ctx.system` elevation — that elevation is the only legal access, so the declared use would fail closed at runtime. §8.4.6/§11.1 follow.
- v1.17 — Table access is two-class (D-136): a table with RLS is app-scoped (the policies decide its rows; `facilis_app` holds DML on it) and a table without RLS is system-only (no privilege for the app role; reachable only through the privileged owner connection and the audited `facilis_system`). `ensureAppRole` reconciles the grants with the live catalog after migrations, installs no table default privilege (a new table fails closed until it enables RLS), and the app role is `NOINHERIT` so its `facilis_system` membership (needed for the audited `SET ROLE`) does not inherit the system grants. `sessions`/`user_roles` become app-scoped with an `EXISTS` policy over `users`; `roles`/`role_permissions` are system-only. §5.2/§5.3/§8.4.6 follow.
- v1.16 — The project graph shows every real page, explicit page links and audited elevation (D-134): page nodes are `src/pages/**` only (all pages, including pages with no API calls), with URL paths from the explicit route table; `page-link` edges follow `Link`/`NavLink`/`navigate` targets; a route→table edge reached through `ctx.sudo`/`ctx.system` is marked with one warning colour and a route-card chip; selecting a page opens a bounded static structure inspector (nested components/sections, `Outlet` composition, dynamic branches marked), not a rendering. §10.2 follows.
- v1.15 — Route descriptions are source documentation (D-129): `description` in the `defineAuthorizedHandler` config is the route's one-sentence, English summary (≤120 characters ≈ two lines) and flows through `@facilis/analyze`'s `RouteNodeData` to the project-graph route card, as a quoted source line clamped to two lines. The analyzer warns `route-description-length` above the cap; patch validator rule 17 `route-description` warns (never blocks) when a patched route's sentence is missing, too long, or unchanged while the route's contract changed, and the assistant writes/refreshes it in the same patch turn. Consumers are OpenAPI, the analyzer, the graph and the AI context — none negotiates a locale, so the field is never a `t()` key and the app's user-facing language stays in `locales/*.json`. §7.3/§7.4/§9.3/§10.2 follow.
- v1.14 — Operator logging and single sign-on (D-119/D-120). Logging is one pipeline with four streams (access, error, audit, app): `defineAuthorizedHandler` records exactly one access entry on every exit path, unexpected failures stay server-side, the sudo trail joins the same sink, and a route can append app lines/audit events through `ctx.log`. Entries are JSON Lines files in `<project>/.facilis/logs/` (dev default, opened from the IDE editor) or stdout (production default), selected by `FACILIS_LOG_SINK`; there is **no HTTP endpoint that serves logs**. Sinks are env-owned, redaction/caps are structural, audit entries carry a SHA-256 `seq`/`prevHash`/`hash` chain and audit writes fail closed, rotation keeps `FACILIS_LOG_KEEP` files, and the deploy owns WORM/retention (O-019). SSO is framework auth: `auth.sso.providers` (OIDC, generic OAuth2, SAML) with secrets only as env-var names, framework-owned `/api/auth/sso/{providers,start,callback}` routes, OIDC discovery + PKCE + nonce + ID-token verification (`jose`), generic OAuth2 userinfo mapping, SP-initiated SAML validated by `@node-saml/node-saml` (lazily imported), single-use DB-backed state, `auth_identities`/`auth_sso_states` with RLS, conservative linking (verified email only), JIT provisioning with the provider/default role, and audit events without tokens or emails. §4.2/§5.3/§5.6/§7.1/§7.4/§8.6/§8.7/§11.4/§12 follow.
- v1.13 — Background jobs (D-107): a durable `facilis_jobs` queue with config-driven concurrency, retry, timeout and cancellation; named definitions in `server/jobs/**/*.ts`; the server-only `ctx.jobs` API (enqueue returns an id, schedule at an instant, read the queue/running jobs, cancel); every attempt in a system context through `runAsSystem` with the sudo audit; persisted queue state with at-least-once recovery. There is no workflow construct yet (O-017); its design is approved in D-135 ([WORKFLOWS.md](./WORKFLOWS.md)) and implementation is planned in W1–W3. §5.1/§5.2/§5.6/§7.1/§7.4/§7.9/§8.4.5/§14.2 follow.
- v1.12 — Views gain an optional own permission (D-098): without it they keep the D-097 invoker behaviour (base tables' RLS); with it they are definer views (`security_invoker = false`) gated by that permission in `app.permissions`, and the base tables are not consulted — the view is a table-like resource, full read-only SQL, developer-owned. The Create-view dialog offers the permissions declared in `facilis.config.ts`. Sudo (D-099) adds an audited server-side system context: `ctx.sudo({ operation, reason, tables }, fn)` runs inside a SAVEPOINT as `facilis_system` (NOLOGIN, NOSUPERUSER, BYPASSRLS, DML only), records `started`/`succeeded`/`failed` entries on a dedicated append-only log (stdout JSON lines for now; not a DB table) with the user + session hash, and fails closed if the log is unavailable. `ctx.system` is the session-less system actor for public/bootstrap routes (registration), the handler event no longer carries the raw client (`ctx.db` is the only default DB surface; escalation is only sudo/system), `runAsSystem` is the job/CLI counterpart, and the analyzer warns `route-direct-db` for raw client access. §5.2/§5.3/§7.4/§8.4.5/§8.5/§8.6/§11.2/§11.4/§12 follow.
- v1.11 — The Data Explorer gains a query console and declarative SQL views (D-097): `POST /__facilis/dev/query` runs one read-only statement (read-only transaction, 5 s timeout, capped rows) and its Create-view action stores `db/views/<name>.ts` with `defineView(...)`, while the framework creates the view with `security_invoker = true` so a route selecting it inherits the base tables' RLS. The live transport is now kernel-mediated (same-origin preview URL through the Studio's Service Worker), which fixes the panel when the app preview is popped out (O-011 narrowed to the declared AST half and preview mode C). §4.2/§5.2/§6.3/§10.2/§11.1/§11.2/§11.4/§12 follow.
- v1.10 — The API Flow panel is removed (D-095): the project graph is the single API/schema visualizer, and it needs no booted app. The Data Explorer keeps the live code↔DB drift but its connection strategy is open (O-011: declared schema from AST first, live drift through a kernel-mediated dev proxy instead of the preview iframe). `/_openapi.json` remains a framework endpoint; §10.2/§11.1/§12 follow.
- v1.9 — The generated project is template v2 (D-090): Tailwind CSS v4 + Base UI with shadcn-style components copied into `src/components/ui` and owned by the project; the theme is the shadcn role vocabulary in `src/styles.css`, and a dev-only Vite plugin works around the WASI scanner bug (tailwindcss#20605). `@facilis/ui` is removed entirely (D-096): new projects use template v2 and projects created before D-090 are not supported. §2.1/§4/§4.2/§5.7 follow.
- v1.8 — Source Control becomes a place where history is visible: clicking any change opens a side-by-side HEAD ↔ working-tree diff with the first hunk revealed (D-089), and a repository can open a commit graph as an editor-area tab — React Flow cards laid out by lane, with merge edges, branch and HEAD badges and a details inspector (D-088). No contract change; §10.2 follows.
- v1.7 — The API Flow becomes an editor-area tab instead of a sidebar view, laid out as pages → routes → tables with an inspector and a list view; it now scans `src/**` for the client files that call each route and shows them as page nodes (direct references and one import hop, D-087). No contract change; §10.2/§12 follow.
- v1.6 — Phase 3 complete. The API Flow renders the AST-augmented `/_openapi.json` with React Flow and jumps to the route source (D-085); the Release Preview engine `buildReleasePreview` lands in `@facilis/core` with the SDK contract amendment for `ApiDiff.changed`/`ApiRouteRef.dbTables` (§7.7), and the Studio diffs git refs read from the VFS instead of booting them, resolving O-008 (D-086, §11.3).
- v1.5 — Phase 3.1 and the Phase 4 validator: the dev-only `GET /__facilis/dev/schema` (D-083) answers `{ code, live, drift, warnings }` for the Entity Explorer, and `@facilis/db` gains `liveSchemaSnapshot`/`diffSchemaSnapshots` (§6.3, §11.1, §11.4). `@facilis/ai` implements the 16-rule validator with an injected `SyntaxChecker` and a typed `PatchContext` (§9.3, D-084); the IDE validates at proposal, Apply and VFS-write time. The retry loop and Model B were then future; the retry loop is now implemented (§9.4, D-100), Model B remains future.
- v1.4 — One project config: Nitro options (and the framework defaults `serverDir: "./server"` / `experimental.openAPI: true`) move into `facilis.config.ts`'s optional `nitro` section, and `facilis()` mounts Nitro and returns `Plugin[]` (D-034). Generated projects have no `nitro.config.ts` and no `nitro()` import.
- v1.3 — Phase 0 headless results: `defineRouteMeta` inside `defineAuthorizedHandler` is **not** detected by Nitro's scanner (A16), so `@facilis/nitro` must ship a framework-owned AST pass + OpenAPI facade (§6.9, §13 risk 3). Fixed §8.4.5 RLS example: tenant isolation must be `AS RESTRICTIVE` and GUC role reads must use `nullif(..., '')` before casting to jsonb. Both findings came from the Phase 0 spike, retired after they landed in `@facilis/nitro` and `@facilis/db` (commit `de17169`).
- v1.2 — Renamed framework to **Facilis** (`@facilis/*`, `facilis.config.ts`, `/__facilis/*`, `Facilis*` types, `FACILIS_INITIAL_ADMIN`). Corrected runtime model: **Nitro v3 runs as a Vite plugin**, `vite dev` is the single dev server for frontend and backend. Added §10.6 "Runtime model inside Vivari". Updated Phase 0 tickets.
- v1.1 — Added full role definition & assignment flow (§8.4), added `FacilisConfig.auth.roles`/`defaultRole`, removed Postgres roles in favor of app roles with session vars, added `FACILIS_INITIAL_ADMIN` bootstrap.
- v1.0 — Design complete. Phase 0 ready.

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [Locked Decisions](#2-locked-decisions)
3. [Architecture Overview](#3-architecture-overview)
4. [Repository Layout](#4-repository-layout)
5. [Facilis Packages](#5-facilis-packages)
6. [The `/__facilis/manifest` Endpoint](#6-the-__facilismanifest-endpoint)
7. [Type Reference](#7-type-reference)
8. [Security Model](#8-security-model)
9. [AI Orchestration](#9-ai-orchestration)
10. [Studio (Vivari Fork)](#10-studio-vivari-fork)
11. [Data & Release Tooling](#11-data--release-tooling)
12. [Development Phases](#12-development-phases)
13. [Risks & Mitigations](#13-risks--mitigations)
14. [Acceptance Criteria](#14-acceptance-criteria)
15. [Open Questions](#15-open-questions)

---

## 1. Vision & Philosophy

### 1.1 The Product

**Facilis** is a **static, browser-based low-code framework** where internal team developers:

1. Clone a git repo into a WebContainer IDE (Vivari)
2. Chat with an AI to scaffold Nitro/PGlite/React code that follows strict framework conventions
3. See an API flow visualizer and live preview update in real time
4. Preview the schema migration impact before pushing to production

### 1.2 Low-Code, Redefined

"Low-code" here does **not** mean configuration panels and modals. It means:

> **A framework that makes the right way the easy way, so developers write only the unique 20% of their application.**

Pre-constructed elements are **code**: NPM packages that export components, routes, security primitives, and conventions. There are no hidden schemas, no UI-only configuration, no round-tripping from visual to code.

### 1.3 Core Principles

| Principle | Meaning |
|---|---|
| **Code is the source of truth** | The UI visualizes and proposes; the filesystem is authoritative. |
| **Vivari is the OS** | All filesystem access goes through Vivari's VFS. OPFS is a write-behind mirror. Never bypass. |
| **Vite is the runtime** | Nitro v3 runs as a Vite plugin. `vite dev` is the single dev server. One process, one port, one HMR loop. |
| **The endpoint is a projection** | `/__facilis/manifest` reflects the running project. It is never committed. It cannot drift from code. |
| **Security is structural** | `defineAuthorizedHandler` + RLS + Zod. A bug in one layer is caught by the next. |
| **Extensibility via NPM** | Blocks, resources, and auth flows are standard TypeScript packages. No plugin registry, no manifest file. |
| **Static Studio, zero backend** | The IDE is an SPA served from a CDN. Git is identity. AI is BYO-key. |

### 1.4 MVP Demo

> User opens Studio → pastes GitHub PAT → clones starter repo → Vivari boots (`vite dev`) → chat *"make a todo app"* → AI generates files → Vite HMR refreshes → API graph updates → user commits and pushes.

**Target:** working, secure, authenticated todo app in under 3 minutes from fresh clone.

---

## 2. Locked Decisions

### 2.1 Stack

| Layer | Choice |
|---|---|
| Backend framework | **Nitro v3** — as a **Vite plugin** (`nitro/vite`) |
| Dev server | **Vite** — `vite dev` is the single entry point |
| ORM | **Drizzle ORM** |
| In-browser DB | **PGlite** (WASM Postgres) |
| Production DB | **PostgreSQL** |
| Frontend | **React 19 + Tailwind CSS v4 + shadcn/ui** (Base UI primitives), with the components copied into the project (template v2, D-090) |
| Validation | **Zod** via `nitro-openapi-schemas` |
| Runtime | **Vivari** (WebContainer) — Vite + Nitro plugin + PGlite in browser |
| API contract | Nitro OpenAPI (`/_openapi.json`), `x-db-tables` extension |
| Studio base | **Fork of Vivari Studio** (MIT-licensed) |

### 2.2 Product Decisions

| Area | Decision |
|---|---|
| **AI role** | Constrained scaffolding: generates code that obeys framework contracts. Never reinvents primitives. |
| **AI mode (MVP)** | Model A — one-shot with preloaded `FacilisManifest` |
| **AI mode (target)** | Model B — tool-use loop with explicit tool surface |
| **Persistence** | Git (remote) = source of truth; OPFS = write-behind mirror via Vivari |
| **Git auth** | GitHub: OAuth device flow (D-082); GitLab/Gitea/Forgejo: PAT or account password (D-081); token per operation, nothing stored |
| **Studio** | Static SPA, no backend, no accounts (git = identity) |
| **LLM** | BYO key, direct browser → provider |
| **Source of truth** | Code only. Visual layer is read-only projection. |
| **Multi-project** | First-class: switch projects like any IDE |
| **Multi-tenancy** | Full RBAC per generated app |
| **Role model** | App roles only (defined in config, expanded to permissions). **No Postgres roles.** |
| **Migration execution** | Studio **previews only**. Pipeline runs `drizzle-kit migrate`. |
| **Deploy** | Out of scope. Handled by git pipelines. |
| **i18n** | From day one. Message keys everywhere. API returns codes. |

### 2.3 Framework Config Decisions

- `release.ref` — configurable per project, defaults to `origin/main`
- `facilis.config.ts` — lives at repo root, committed; the **only** project config (framework sections plus optional Nitro options)
- Blocks — code files: `index.tsx` + `manifest.ts`, published to NPM
- Git credential — GitHub signs in with the OAuth device flow; other hosts take a PAT (or an account password where allowed). Per operation, never sent to the LLM
- Migration ordering conflicts — Studio warns, developer resolves
- Roles & permissions — **declared in `facilis.config.ts`**, materialized as seed by auto-generated migration
- Nitro config — the optional `nitro` section of `facilis.config.ts`; `@facilis/nitro` owns the framework defaults (`serverDir: "./server"`, `experimental.openAPI: true`) and `facilis()` mounts Nitro (D-034)

---

## 3. Architecture Overview

### 3.1 System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│  Static SPA on CDN (COOP/COEP headers required)              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Facilis Studio (forked from Vivari Studio)            │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  IdeController (imperative core)                 │  │  │
│  │  │  ├── Monaco models, tabs, terminals              │  │  │
│  │  │  ├── KernelBridge (VFS access)                   │  │  │
│  │  │  ├── ScmSession (isomorphic-git on VFS)          │  │  │
│  │  │  └── applyPatch(), openProject(), closeProject() │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  React Chrome                                    │  │  │
│  │  │  ├── Explorer / Editor / Terminal / Preview      │  │  │
│  │  │  ├── [NEW] ChatPanel (AI)                        │  │  │
│  │  │  ├── [NEW] ProjectGraphPanel (AST)               │  │  │
│  │  │  ├── [NEW] DataExplorerPanel                     │  │  │
│  │  │  ├── [NEW] ReleasePreviewPanel                   │  │  │
│  │  │  └── [NEW] ProjectSwitcher (Home.tsx extension)  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Vivari Kernel                                         │  │
│  │  ├── FS Worker (Rust/Wasm VFS) ← single source of truth│  │
│  │  ├── opfs-persistence.js (write-behind mirror)         │  │
│  │  ├── Vite dev server  ◄── SINGLE PROCESS               │  │
│  │  │   └── Nitro via facilis() (routes, OpenAPI, SSR)    │  │
│  │  └── PGlite (WASM Postgres, RLS-enabled)               │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
             │
             ├── isomorphic-git ──→ GitHub / GitLab (PAT)
             └── HTTPS ──→ LLM provider (BYO key)
```

### 3.2 Key Abstractions

| Layer | Responsibility |
|---|---|
| **Vivari VFS** | Authoritative filesystem. All reads/writes flow through `kernel.fs`. |
| **OPFS** | Mirror persisted by `opfs-persistence.js`. Not accessed directly by Studio. |
| **Vite** | The dev server. Serves the React client with HMR, runs Nitro as a plugin, exposes a single origin for preview. |
| **Nitro plugin** | Mounted inside Vite. Serves API routes, generates OpenAPI, runs the server code in an isolated worker. |
| **`/__facilis/manifest`** | Runtime projection of the running project. Consumed by AI, visualizer, entity explorer. |
| **`/_openapi.json`** | Nitro-generated OpenAPI 3.1.0 spec, enriched with `x-db-tables` / `x-db-columns` / `x-permission`. |
| **`@facilis/*` packages** | The framework itself. Installed in every generated project. |

### 3.3 Data Flow: AI Patch → Preview

```
User chat ──→ AI (BYO key) ──→ AIResponse (JSON)
                                    │
                                    ▼
                             Patch Validator
                                    │
                              (ok)  │  (errors) ──→ Retry (until valid)
                                    ▼
                        IdeController.applyPatch()
                                    │
                                    ▼
                        kernel.writeFiles(files)
                                    │
                                    ▼
                             Vivari VFS
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Vite HMR        Nitro worker     OPFS mirror
              (client)        reload (server)
                    │               │
                    ▼               ▼
              Preview updated   /__facilis/manifest refreshed
                                    │
                                    ▼
                             Visualizer updates
```

---

## 4. Repository Layout

### 4.1 Monorepo (framework + studio)

```
/
├── packages/
│   ├── core/                 @facilis/core
│   │   ├── src/
│   │   │   ├── config.ts             defineConfig()
│   │   │   ├── route.ts              defineAuthorizedHandler()
│   │   │   ├── manifest.ts           BlockManifest, FacilisManifest types
│   │   │   ├── i18n.ts               t(), catalog registry
│   │   │   ├── release.ts            ReleasePreview types
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── db/                   @facilis/db
│   │   ├── src/
│   │   │   ├── client.ts             Drizzle + PGlite adapter
│   │   │   ├── policy.ts             drizzle-policy wrapper
│   │   │   ├── rls.ts                auto-RLS migration plugin
│   │   │   ├── diff.ts               ReleasePreview engine
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── auth/                 @facilis/auth
│   │   ├── src/
│   │   │   ├── middleware.ts         session middleware
│   │   │   ├── session.ts            Lucia-style sessions
│   │   │   ├── rbac.ts               hasPermission(), expandRoles()
│   │   │   ├── db.ts                 users, sessions, roles, role_permissions, user_roles schema
│   │   │   ├── seed.ts               generates role seed from config
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── storage/              @facilis/storage (D-053)
│   │   └── src/              content-addressed blobs, local + S3-compatible drivers, signed tokens
│   │
│   ├── time/                 @facilis/time (D-056)
│   │   └── src/              Intl formatting, calendar days, DST-aware day bounds
│   │
│   ├── i18n-db/              @facilis/i18n-db (D-057)
│   │   └── src/              translated content fields + optional catalogue overlay
│   │
│   ├── ai/                   @facilis/ai
│   │   ├── src/
│   │   │   ├── prompt.ts             system prompt builder
│   │   │   ├── context.ts            context assembly (A vs B)
│   │   │   ├── parser.ts             AIResponse parser
│   │   │   ├── validator/            patch validator (18 rules)
│   │   │   ├── tools/                Model B tool definitions (Phase 4.5)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── nitro/                @facilis/nitro (Vite plugin + Nitro module)
│       ├── src/
│       │   ├── vite.ts                exports facilis() Vite plugin
│       │   ├── module.ts              Nitro module (setup hook)
│       │   └── runtime/
│       │       ├── routes/
│       │       │   ├── __facilis/
│       │       │   │   ├── manifest.get.ts
│       │       │   │   ├── manifest/revision.get.ts
│       │       │   │   └── health.get.ts
│       │       │   └── dev/
│       │       │       ├── query.post.ts     (query preview)
│       │       │       └── schema.get.ts     (schema introspection)
│       │       ├── collectors/
│       │       │   ├── config.ts
│       │       │   ├── blocks.ts
│       │       │   ├── routes.ts
│       │       │   ├── schema.ts
│       │       │   ├── i18n.ts
│       │       │   └── revision.ts
│       │       └── virtual/
│       │           ├── openapi.ts
│       │           └── config.ts
│       └── package.json
│
├── ide/                      Facilis IDE app (fork of Vivari's packages/studio)
│   ├── src/
│   │   ├── components/       (existing + new panels)
│   │   ├── vv/               (IdeController — extend)
│   │   └── ...
│   └── vite.config.ts        (COOP/COEP headers)
│
├── vendor/
│   └── vivari/               Vivari upstream — git SUBMODULE, pinned tag (MIT, never edited)
│       ├── packages/         core, kernel-host, runtime, protocol, vfs, codec, crypto, …
│       ├── scripts/          in-browser npm/pnpm vendoring harnesses
│       └── README.md         (in vendor/) provenance, patch set and submodule update recipe
│
├── starter/                  empty until @facilis/* has a publish target (D-027):
│                             the template is generated from examples/todo-app at
│                             IDE build time (D-062) — no second copy to drift
│
├── examples/
│   ├── todo-app/             template source (v2: Tailwind + shadcn copy-in components, D-090)
│   │                         + Phase 1 acceptance app
│
├── pnpm-workspace.yaml
└── turbo.json
```

### 4.2 Generated Project Layout

```
<project>/
├── server/                       Nitro server root (serverDir)
│   └── routes/api/
│       ├── auth/                 register, login, logout, session; /api/auth/sso/** is framework-owned (D-120)
│       ├── files/                [id].get — token-only download proxy (D-116)
│       ├── jobs/                 index.post, [id].get/delete (D-107)
│       └── todos/                index.get/post, [id].patch/delete,
│                                 [id]/files/index.post, [id]/files/[fileId].delete (D-116)
├── src/                          React client: pages + layouts + components + lib (D-058)
│   ├── app.tsx                   providers + the one explicit route table
│   ├── main.tsx                  theme + i18n + router bootstrap
│   ├── pages/                    login, register, todos, not-found
│   ├── layouts/                  app-layout, auth-layout
│   ├── components/               app-specific pieces (theme/locale/todo widgets)
│   │   └── ui/                   shadcn-style primitives, copied in and owned (D-090)
│   ├── lib/                      api, session, theme, i18n, dates, utils (cn)
│   └── styles.css                the Tailwind entry: @import + @theme + the theme blocks
├── db/
│   ├── schema.ts                 Drizzle tables + policies + auth re-export
│   ├── views/                    SQL views declared with defineView (D-097), one file per view
│   └── migrations/               drizzle-kit output (incl. auth seed)
├── locales/en.json, it.json
├── .facilis/                     dev-only state, never source: db/snapshot.tar.gz, binary/, logs/*.jsonl (D-119)
├── index.html
├── vite.config.ts                plugins: [tailwindcss(), facilis(), react()]
├── facilis.config.ts             the one config: roles, permissions, storage, nitro options
├── tsconfig.json
├── package.json                  scripts.dev = "vite dev"
├── scripts/                      check-pm.mjs, vendor-paths.cjs
├── vendor/                       @facilis/* tarballs, inlined by the IDE (D-032)
└── README.md
```

**Note:** the generated tree **is** the reference app `examples/todo-app` (D-062), not a
separate scaffold: the IDE inlines that source at build time and adds only the npm wrapper,
the liveness `ping` route, the HMR hint/style and the in-process Nitro runner. The
acceptance probe runs from the IDE page, not inside the app. Nitro v3 in Vite mode requires
the server directory to be declared via `serverDir`. `facilis()` mounts Nitro and supplies
it from `facilis.config.ts`: the framework defaults are `serverDir: "./server"` and
`experimental.openAPI: true`, and a project overrides only what it changes in the config's
optional `nitro` section. Route files live under `server/routes/`, not `routes/` at project
root.

---

## 5. Facilis Packages

### 5.1 `@facilis/core`

Public API:

```typescript
// Config
export { defineConfig } from "./config"
export type { FacilisConfig } from "./config"

// Binary storage (D-116/D-117, §5.10)
export { DEFAULT_STORAGE_CONFIG, STORAGE_DRIVERS } from "./config"
export type {
  FacilisStorageConfig,
  FacilisStorageConfigInput,
  FacilisStorageEncryptionConfig,
  StorageDriverKind,
} from "./config"
export { StorageUnavailableError, unavailableStorage } from "./storage"
export type {
  StorageApi,
  StorageDownloadOptions,
  StoragePresignOptions,
  StoragePutResult,
  StorageStream,
  StorageTokenPayload,
} from "./storage"

// Routes (the security contract)
export { defineAuthorizedHandler } from "./route"
export type {
  AuthorizedHandlerConfig,
  AuthorizedHandlerContext,
  AuthContext,
} from "./route"

// Manifest types
export type {
  BlockManifest,
  ApiHint,
  FacilisManifest,
  RouteMeta,
  SchemaSnapshot,
  TableSnapshot,
  ColumnSnapshot,
  ForeignKeySnapshot,
  PolicySnapshot,
} from "./manifest"

// Release tooling (D-086: the engine is browser-safe so the Studio imports it)
export { buildReleasePreview } from "./release-preview"
export type {
  ReleaseMigrationFile,
  ReleasePreviewInput,
  ReleaseRouteFact,
  ReleaseSnapshot,
  ReleaseTableFact,
} from "./release-preview"
export type {
  ReleasePreview,
  SchemaDiff,
  MigrationStatement,
  RiskClass,
  ApiDiff,
  ApiRouteChange,
  ApiRouteRef,
  SecurityDiff,
  BreakingChange,
  ReleaseWarning,
  GitRef,
} from "./release"

// i18n
export { t } from "./i18n"

// Background jobs (D-107; the full type surface is §7.9)
export { defineJob, isJobDefinition, serializeJobData, JobError } from "./jobs"
export type {
  EnqueueJobOptions,
  JobDefinition,
  JobErrorCode,
  JobJson,
  JobListOptions,
  JobOverrides,
  JobQueueStats,
  JobRecord,
  JobRunContext,
  JobStatus,
  JobsApi,
} from "./jobs"
export { DEFAULT_JOBS_CONFIG, facilisJobsConfigSchema } from "./jobs-config"
export type { FacilisJobsConfig, FacilisJobsConfigInput } from "./jobs-config"

// Logging (D-119): entry shapes + ctx.log contract; sinks live in @facilis/nitro
export {
  LOG_KINDS, LOG_LEVELS, NOOP_LOGGER, NOOP_LOGGING_API,
  createAccessEntry, createErrorEntry,
} from "./logging"
export type {
  AccessLogEntry, AppLogEntry, AuditLogEntry, ErrorLogEntry,
  FacilisAuditInput, FacilisLogger, FacilisLoggingApi, FacilisLogRequestMeta,
  LogEntry, LogEntryMeta, LogKind, LogLevel,
} from "./logging"
export { DEFAULT_LOGGING_CONFIG, facilisLoggingConfigSchema } from "./logging-config"
export type { FacilisLoggingConfig, FacilisLoggingConfigInput } from "./logging-config"

// SSO config (D-120); the protocol lives in @facilis/auth
export {
  DEFAULT_SSO_CONFIG, SSO_PROVIDER_KINDS, ssoConfigSchema, ssoProviderSchema,
} from "./sso-config"
export type {
  FacilisSsoConfig, FacilisSsoConfigInput, FacilisSsoProvider, SsoProviderKind,
} from "./sso-config"
```

### 5.2 `@facilis/db`

Exports:

- `createDb(options)` — Drizzle client for PGlite (dev) / Postgres (prod). Dev PGlite is
  in memory; `snapshot()` serializes the cluster, `loadSnapshot` restores it, and
  `activity()` counts client operations so the dev snapshotter can skip idle ticks (D-052).
  The postgres driver (D-068) opens a `pg` pool lazily, has no cluster dump (a postgres
  `snapshot()` rejects), and is reached with the deployment's least-privileged
  `facilis_app` role, so RLS is enforced by the database rather than by a privileged client
- `policyContext` — `drizzle-policy` wrapper for tenant/role scoping
- `rlsMigrationPlugin` — Drizzle-kit plugin that auto-appends RLS policies
- `PolicyScopedDatabase` — type of the db object passed to handlers
- `facilisFiles` — file metadata table (content hash, name, mime, size, owner, tenant) with
  a restrictive `tenant_isolation` policy plus the permissive `facilis_files_tenant_access`
  gate the scoped role needs to insert the metadata row (a restrictive policy alone denies
  everything, D-008); the runtime that writes it is §5.10/D-116
- `fileLinks(parent, { table, column })` — generates the per-entity link table that attaches
  `facilisFiles` rows to a parent row (FK cascades + a `parent_access` policy that inherits
  the parent's RLS through EXISTS, D-053)
- `defineView({ name, columns, query, tables?, permission? })` — declares a full read-only
  SQL view in `db/views/*.ts` and returns a Drizzle view for `db.select().from(...)`. Without
  `permission` the framework creates it with `security_invoker = true`, so a route runs it as
  the policy-scoped `facilis_app` role and the base tables' RLS is the view's permission
  (D-097). With `permission` it is a **definer** view (`security_invoker = false`) gated by a
  `nullif(current_setting('app.permissions', true), '')::jsonb ? '<permission>'` predicate: that
  permission alone decides access and the base tables are not consulted; the permission must
  be declared in `facilis.config.ts` (D-098)
- `applyViews(db, modules, { permissions })`, `viewDefinitionStatement(name, sql, permission?)`,
  `runReadOnlyQuery(db, sql, limit)` — the boot/dev tooling behind `POST /__facilis/dev/query|view`;
  an undeclared view permission is a `view_failed` warning, never a silent grant (§11.2, D-098)
- `facilisJobs` — the persistent job-queue table (name, status, JSONB input/output, attempts,
  maxAttempts, timeoutMs, runAt/startedAt/finishedAt, tenant): tenant-scoped with the framework RLS
  policy, re-exported by the project's `db/schema.ts` so a Drizzle migration owns its DDL (D-107).
  Access is permission-gated at the database level (D-145): `SELECT` requires `jobs:read`,
  `INSERT`/`UPDATE`/`DELETE` require `jobs:exec`; the engine's own scope passes both as framework
  permissions, a request scope carries the session's (or Bearer client's). Only a job *body* runs as
  `facilis_system` (see the audited-sudo bullet). Cross-user visibility within the tenant is the
  endpoint's responsibility — the queue has no owner column.
- `ensureAppRole(db)` — provisions the non-superuser `facilis_app` role and reconciles its
  privileges with the live schema (§8.4.6, D-136): a table with RLS gets DML for the app role, a
  table without RLS gets none and is system-only. Returns the system-only table names.
- `ensureSystemRole(db)`, `runWithSystemRole(db, { sudoId }, fn)`, `runAsSystem(db, opts, fn)`,
  `writeSudoAudit` — the audited sudo identity and append-only trail behind `ctx.sudo`
  (§7.4/§8.4.5, D-099). `facilis_system` is `NOLOGIN NOSUPERUSER BYPASSRLS` with DML grants only;
  it is never assigned to users and never referenced by a policy. `runAsSystem`, the job/CLI
  counterpart, accepts `tables: []` when a job declares no audit tables (D-107); `ctx.sudo`/
  `ctx.system` still require a non-empty subset

### 5.3 `@facilis/auth`

Exports:

- `sessionMiddleware` — Nitro middleware populating `event.context.user`; for a valid
  session it also sets `AuthContext.sessionHash` (SHA-256 hex of the session id), which the sudo
  audit writes instead of the raw cookie (D-099)
- `createSession()`, `destroySession()`, `validateSession()` — the `sessions` row key is
  `sha256(cookie id)`; the raw id exists only in the cookie, so a tenant-wide read of the table
  cannot be replayed as a session (D-144)
- API clients (D-142): `createApiClient()`, `listApiClients()`, `revokeApiClient()`, `issueApiToken()`, `validateApiToken()` — a client is a service user (`users.isService`) plus a hashed secret and a fixed role; the framework-owned `POST /api/auth/token` exchanges the client id + secret for a short-lived Bearer token (no refresh token), rate-limited per client id (D-143, `auth.apiClients.rateLimit` → `429 too_many_requests` with `retry-after`), and the session middleware resolves `Authorization: Bearer` before the cookie
- `hasPermission(user, permission)` — RBAC check helper
- `expandRoles(roles, roleMap)` — expands roles to permission set (pure function, reads config)
- `db` — re-export of the auth tables (`users`, `sessions`, `roles`, `role_permissions`, `user_roles`, `api_clients`, `api_tokens`)
- `seedFromConfig(config)` — generates the seed migration from `FacilisConfig.auth`
- `registerInitialAdmin()` — grants `admin` once, when the registration's canonical email matches `FACILIS_INITIAL_ADMIN` AND the caller presents the operator's `FACILIS_INITIAL_ADMIN_TOKEN` (D-150); the email alone is not a credential
- `normalizeEmail(email)` — canonical email form (trim + lowercase) used by every auth lookup, insert and comparison; `users` carries a unique `lower(email)` index (D-150)
- Email verification (D-156): `issueEmailVerification()`, `consumeEmailVerification()` and `markEmailVerified()` own the single-use token (`sha256(token)` in `auth_email_verifications`, TTL from `auth.verification.tokenTtlMs`) and the `users.email_verified_at` transition; delivery is the project's, never the framework's
- Login/logout/register route blueprints (optional to install)
- Role-assignment API blueprint (`POST /api/users/:id/roles`)
- Single sign-on (D-120): `ssoProviderList()` (the public provider list), the start/callback orchestration for OIDC/OAuth2/SAML, the `auth_identities` and `auth_sso_states` tables, and the framework-owned routes `GET /api/auth/sso/providers`, `GET /api/auth/sso/:provider/start` and `GET|POST /api/auth/sso/:provider/callback` (implemented by `@facilis/nitro`)

**Auth tables (from `@facilis/auth/db`):**

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored canonical (lowercase); unique index on lower(email) (D-150)
  tenantId: tenantColumn(), // @facilis/db: uuid NOT NULL DEFAULT app.tenant_id (D-040)
  passwordHash: text("password_hash"),
  isService: boolean("is_service").default(false).notNull(), // D-142: API service account, never loggable
  emailVerifiedAt: timestamp("email_verified_at"), // null = pending; set by the link or an SSO claim (D-156)
  createdAt: timestamp("created_at").defaultNow(),
}, () => [uniqueIndex("users_email_lower_idx").on(sql`lower(${table.email})`)])

// App-scoped (D-136): no tenant column of its own, so the policy inherits the parent user's
// visibility — exists (select 1 from users u where u.id = user_id), the D-053 pattern.
// RLS being on is what grants facilis_app access to the table at all.
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, () => [parentUserAccessPolicy("sessions_user_access")]).enableRLS()

// API clients (D-142): app-scoped through the parent service user, like sessions. The secret and
// the tokens are SHA-256 hashes; plaintext exists only in the creation/issue result.
export const apiClients = pgTable("api_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),                 // validated against config.auth.roles
  userId: uuid("user_id").notNull().references(() => users.id), // the service user
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
}, () => [parentUserAccessPolicy("api_clients_user_access")]).enableRLS()

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  clientId: uuid("client_id").notNull().references(() => apiClients.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  revokedAt: timestamp("revoked_at"),
  lastUsedAt: timestamp("last_used_at"),
}, () => [parentUserAccessPolicy("api_tokens_user_access")]).enableRLS()

// System-only (D-136): no RLS, no privilege for facilis_app. Seeded by the migration and never
// read at runtime — permissions reach the app from facilis.config.ts via expandRoles().
export const roles = pgTable("roles", {
  name: text("name").primaryKey(),
})

export const rolePermissions = pgTable("role_permissions", {
  role: text("role").references(() => roles.name),
  permission: text("permission"),
})

export const userRoles = pgTable("user_roles", {
  userId: uuid("user_id").references(() => users.id),
  role: text("role").references(() => roles.name),
  assignedBy: uuid("assigned_by"),
  assignedAt: timestamp("assigned_at").defaultNow(),
}, () => [parentUserAccessPolicy("user_roles_user_access")]).enableRLS()

// Single sign-on (D-120). Written only inside the audited ctx.system elevation.
export const authIdentities = pgTable("auth_identities", {
  provider: text("provider").notNull(),       // auth.sso provider id
  subject: text("subject").notNull(),         // IdP subject / NameID
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email"),
  tenantId: tenantColumn(),
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
}, (t) => [primaryKey({ columns: [t.provider, t.subject] }), ...rlsForTable({ tenantColumn: "tenant_id" }).policies])

export const authSsoStates = pgTable("auth_sso_states", {
  state: text("state").primaryKey(),          // 32 random bytes, base64url, single use
  provider: text("provider").notNull(),
  codeVerifier: text("code_verifier"),        // PKCE S256 verifier
  nonce: text("nonce"),
  requestId: text("request_id"),              // SAML AuthnRequest id (InResponseTo)
  redirectTo: text("redirect_to"),            // same-origin path only
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  tenantId: tenantColumn(),
}, () => [...rlsForTable({ tenantColumn: "tenant_id" }).policies])

// Email verification links (D-156): one active token per user, sha256(token) as the key; written
// and consumed inside the audited ctx.system elevation because no session exists yet.
export const authEmailVerifications = pgTable("auth_email_verifications", {
  id: text("id").primaryKey(),                // sha256(token)
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  tenantId: tenantColumn(),
}, () => [...rlsForTable({ tenantColumn: "tenant_id" }).policies])
```

**Critical:** the `role_permissions` table is a **projection** of `facilis.config.ts`. It is seeded at migration time and never written at runtime.

**Single sign-on (D-120).** A provider is declared in `auth.sso.providers` (OIDC, generic OAuth2 or SAML); the config names the ENV VAR that holds its secret, never the secret. The flow is authorization-code based: a single-use state row (plus PKCE verifier, OIDC nonce or SAML request id) is written before the redirect, the callback consumes it once, identity resolution and user/role/identity writes run inside the audited `ctx.system` elevation, and the session is created with `createSession` + the framework cookie helper. An unverified email never links to or provisions a user; `autoProvision` (default true) creates one with a null password hash and the provider's role. The public provider list hides a provider whose secret/certificate env var is missing. Email verification (D-156) decides the linking rule: a VERIFIED password account links (the mailbox is proven), while a pending one is claimed by the identity — its placeholder password is removed and the account marked verified — so an attacker who merely registered the address first cannot keep it. See `docs/SSO.md`.

### 5.4 `@facilis/blocks` — removed (D-131)

The headless-blocks package never shipped and is retired: the template v2 frontend copies Base
UI primitives into the project (`src/components/ui`, D-090/D-096) and the AI writes pages against
that owned source, so a versioned block supply chain has no consumer. The skeleton package is
deleted (§12 keeps the Phase 5 number as a tombstone). The `BlockManifest` type and the
manifest `blocks` section stay as a reserved, always-empty slot (§7.2/§7.3); dropping them is a
manifest revision, not part of this retirement.

### 5.5 `@facilis/ai`

Exports:

- `buildPrompt(manifest, mode)` — system prompt (A or B variant)
- `assembleContext(vivari, manifest, openFiles, diff, mode)` — preload builder
- `parseResponse(raw)` — AIResponse parser
- `buildProjectContext(input)` — projects an `Analysis` (+ optional pre-patch one) into the
  typed validator context; the caller supplies the facts (the IDE from the analyzer worker)
- `validatePatch(patches, { context, requiresConfirmation, allowedRootFiles })` — 18-rule
  validator over analyzer facts (D-092); the main entry stays browser-safe and the only
  parser is the injected syntax checker
- `applyPatch(controller, patch)` — writes through `kernel.writeFiles`

### 5.6 `@facilis/nitro` — Vite plugin + Nitro module

This package has **four entry points**: the Vite plugin (which also mounts Nitro), the Nitro module it carries, the route-facing session-cookie helpers, and the route-facing binary-storage helpers (D-116).

**Entry 1 — `@facilis/nitro/vite` (Vite plugin + Nitro mount):**

```typescript
// packages/nitro/src/vite.ts
import { resolve } from "node:path"
import type { Plugin } from "vite"
import type { NitroModule } from "nitro/types"
import { nitro } from "nitro/vite"

import { loadNitroOptions } from "./config"
import { facilisNitroModule } from "./module"

export interface FacilisVitePlugin extends Plugin {
  readonly nitro: NitroModule
}

export type FacilisPlugins = [FacilisVitePlugin, ...Plugin[]]

export function facilis(): FacilisPlugins {
  const plugin: FacilisVitePlugin = {
    name: "facilis",
    enforce: "pre",
    nitro: facilisNitroModule,
    async config(userConfig) {
      // Nitro's Vite plugin reads this key; `enforce: "pre"` makes this hook run first.
      const root = userConfig.root === undefined ? process.cwd() : resolve(userConfig.root)
      return { nitro: await loadNitroOptions(root) }
    },
  }
  return [plugin, ...nitro()]
}
```

The plugin also owns the route-metadata virtual module: it analyzes the project with
`@facilis/analyze` (parser injected from `rolldown/utils`), maps the route facts to the
manifest/OpenAPI contract and invalidates on any project source edit. `facilis()` takes no
options; the analyzer owns the DSL layout (`server/routes/**`, `server/api/**`).

**Entry 2 — `@facilis/nitro` (Nitro module):**

```typescript
// packages/nitro/src/module.ts
import type { NitroModule } from "nitro/types"

export const facilisNitroModule: NitroModule = {
  setup(nitro) {
    // 1. Expose the generated OpenAPI spec as a virtual import
    nitro.options.virtual ||= {}
    nitro.options.virtual["#facilis/openapi"] = () =>
      `export default ${JSON.stringify(nitro.options.openAPI?.spec ?? {})}`

    // 2. Expose the resolved facilis.config.ts
    nitro.options.virtual["#facilis/config"] = () =>
      `import cfg from "${nitro.options.rootDir}/facilis.config.ts"; export default cfg`

    // 3. Register the meta routes
    nitro.options.handlers.push(
      { route: "/__facilis/manifest", handler: "./runtime/routes/__facilis/manifest.get" },
      { route: "/__facilis/manifest/revision", handler: "./runtime/routes/__facilis/manifest/revision.get" },
      { route: "/__facilis/health", handler: "./runtime/routes/__facilis/health.get" },
    )
  },
  name: "facilis",
}
```

> **Nitro v3 note (verified 2026-10-25 against `nitro@3.0.260903-beta`):** there is no
> `nitro/kit` entry point and no `defineNitroModule` helper — a Nitro module is a plain
> object `{ name, setup(nitro) }` typed via `NitroModule` from `nitro/types` (D-010).
> `nitro()` from `nitro/vite` returns `Plugin[]`; a Vite plugin may carry the module on its
> `nitro` key and pass Nitro options through the `nitro` user-config key, which is how
> `facilis()` works. Virtual-module factories in `nitro.options.virtual` return module source
> strings, evaluated on load.

**Framework middleware, logging and SSO routes.** The module registers the `context` (db) and `session` (auth) middleware on `/**`, in that order. Its runtime also owns the logging pipeline (D-119): the `runtime/logging/` module resolves the sink from the environment, appends JSON Lines to `<project>/.facilis/logs/` or stdout, and is attached to every request by the context middleware, which also resolves/returns `x-request-id`. Access/error entries are produced by `defineAuthorizedHandler` in `@facilis/core`; the sudo trail is bridged in from `@facilis/db`. No route exposes the log files.

When `auth.sso.providers` is non-empty, the module also registers one handler for `/api/auth/sso/**` (D-120) in dev and production alike. The handler is a normal `defineAuthorizedHandler` with `permission: []`: it lists the public providers, starts a login (302 to the IdP) and completes the callback (302 back to `redirectTo`). SAML's ACS POST body is parsed and Zod-validated inside the handler, and `@node-saml/node-saml` is imported lazily so projects without SAML never load it.

**Registration in the starter's `vite.config.ts`:**

```typescript
import { defineConfig } from "vite"
import { facilis } from "@facilis/nitro/vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [facilis(), react()], // facilis() mounts Nitro; order in this array does not matter
})
```

**Nitro options in `facilis.config.ts`:**

```typescript
import { defineConfig } from "@facilis/core"

export default defineConfig({
  // ...release, db, i18n, blocks, auth
  nitro: {
    // pass-through Nitro options; only what differs from the framework defaults
    devServer: { runner: "self" }, // the in-VM template's constraint (D-034)
  },
})
```

`facilis.config.ts` is the only Nitro config a project has. The framework defaults it overlays are `serverDir: "./server"` and `experimental.openAPI: true`; a project that still keeps a `nitro.config.ts` keeps working (Nitro's c12 loader reads it) but `facilis.config.ts` wins, and new projects never create one.

**Entry 3 — `@facilis/nitro/session` (session-cookie helpers for routes):**

```typescript
// packages/nitro/src/session-cookie.ts
import { SESSION_COOKIE_NAME } from "@facilis/auth"
import type { FacilisRequestEvent } from "@facilis/core"
import { deleteCookie, getCookie, setCookie, type H3Event } from "nitro/h3"

export interface SessionCookieOptions { ttlMs: number; secure?: boolean }
export function setSessionCookie(event: FacilisRequestEvent, sessionId: string, options: SessionCookieOptions): void
export function clearSessionCookie(event: FacilisRequestEvent): void
export function sessionIdFromRequest(event: FacilisRequestEvent): string | null
```

Routes never serialise a `Set-Cookie` header themselves: the cookie name and its attributes
(`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` in production) are the framework contract
(contracts §4.4), and h3's `setCookie`/`deleteCookie` are what write them onto the event's
response headers — the surface this server merges into the response (a `Set-Cookie` on a
returned `Response` is dropped in the in-VM Nitro dev path, D-038). h3 also appends rather
than replaces, so a cookie another handler staged on the same response survives.

**Entry 4 — `@facilis/nitro/storage` (upload/download helpers for routes, D-116):**

```typescript
export interface StoredFile { id: string; name: string; mime: string; size: number; url: string }

export function storeUpload(input: {
  event: FacilisHandlerEvent
  db: PolicyScopedDatabase
  storage: StorageApi
  auth: AuthContext | null
  file: File
}): Promise<StoredFile | Response>

export function sendStoredFile(input: {
  db: PolicyScopedDatabase
  storage: StorageApi
  fileId: string
  token: string
  tenantId?: string
  responseName?: string
}): Promise<Response>
```

`storeUpload` enforces `storage.maxUploadBytes` from the file's size and streams the bytes
through the driver — after the platform has parsed the multipart body once (`request.formData()`
materializes the form, bounded by `maxUploadBytes`); no storage/crypto layer buffers it whole.
It inserts the `facilis_files` metadata row (owner from `auth`, tenant from the deployment) and
returns the stored file with a signed `/api/files/:id?token=…` URL. It does **not** attach the
file to a parent entity: the project route inserts the generated `fileLinks` row through
`ctx.db` (§5.10). `sendStoredFile` verifies the token and loads the metadata, then returns the
plaintext as a streamed response body with `content-length` from the stored plaintext size — or
redirects to a driver-presigned S3 GET (an encrypted deployment always streams and decrypts — it
has no presigned redirect); the response carries `x-content-type-options: nosniff` and an
attachment `content-disposition`. Both return a `Response` on rejection (e.g.
`file_too_large` 413, `storage_unavailable` 503).

**Why separate entry points?** Vite plugins can extend Nitro programmatically by exposing a `nitro` key (a Nitro module) on the plugin object, and Nitro's own plugin mounts by returning `Plugin[]`. `facilis()` is both: it returns the Facilis plugin carrying the module, followed by `nitro()`'s plugins. The user writes one plugin in `vite.config.ts` and gets Nitro plus all `__facilis` routes, virtual modules, and collectors. The session and storage helpers are their own entry points because they are server-runtime code: the session helpers import h3 while core's route contract does not (contracts §4.1), so the single `FacilisRequestEvent` → `H3Event` narrowing lives there and a handler stays free of h3 imports; the storage helpers are where `@facilis/nitro` implements core's `StorageApi` over the Node-only `@facilis/storage` package, which core itself must not depend on.

**Background jobs (D-107).** A project's server code can start an independent unit of work and
schedule it for a future instant, then read, inspect or cancel it. The design reference is
[`JOBS.md`](./JOBS.md); the public types are §7.9.

- **Definitions** are one default export per `server/jobs/**/*.ts` (`defineJob`), nested
  directories allowed, `*.test.ts` ignored. The Nitro module registers the `#facilis/jobs`
  virtual module (the same mechanism as `#facilis/config`), which renders the scanned modules as
  `JobModule[]`; an invalid or duplicate definition becomes a `job_definition_invalid` manifest
  warning and is skipped, never a boot failure.
- **Engine.** `src/runtime/jobs/engine.ts` starts at most `jobs.maxConcurrent` attempts, claims
  due `queued` rows in `runAt` order, retries a failed attempt after `retryDelayMs` while
  `attempts < maxAttempts`, aborts an attempt at its `timeoutMs`, and cancels a queued or running
  job through the attempt's `AbortSignal`. Enqueue wakes the tick; a timer still re-polls.
- **Persistence and recovery.** With `jobs.persist` and a migrated `facilis_jobs` table the queue
  survives a Nitro worker reload or process restart; `start()` recovers rows left `running` —
  re-queued at `now` when attempts remain, else `failed` with an `interrupted` error (at-least-once
  semantics). A project without the migration degrades to the in-memory store with a
  `jobs_table_missing` warning; a runtime that fails to start is a `jobs_boot_failed` warning, and
  a scheduler/store failure during a tick is a `jobs_runtime_error` warning. Boot never fails
  because of jobs, and a handler whose `ctx.jobs` is the unavailable fallback rejects every call
  with `JobError("job_unavailable")` instead of failing the route.
- **System context.** Every attempt runs through `runAsSystem` (actor `system:job:<name>`,
  operation `jobs:<name>`, the definition's `tables`) in its own `facilis_system` transaction,
  audited started/succeeded/failed on the sudo-audit sink; the job body receives that scoped
  client, never the app client.
- **`ctx.jobs` only.** `defineAuthorizedHandler` carries `JobsApi`: enqueue/schedule returns
  `{ id }`, then `get`/`list`/`queue`/`running`/`cancel`/`stats`. There is deliberately **no HTTP
  endpoint** behind it — a project that needs a user-facing surface writes a normal
  `defineAuthorizedHandler` route with its own permission and Zod body (the example does). The
  API is also on `event.context.facilis.jobs` for framework middleware.
- **Config** is the six-key `jobs` section of `facilis.config.ts` (§7.1). Jobs are independent:
  the job context does not expose `jobs.enqueue`, so no chain is expressible — a workflow is a
  separate construct (O-017).
- **Runtime boundary.** The scheduler assumes one long-lived server process per database. A
  serverless deployment that freezes the process cannot promise a scheduled instant (O-017); a
  hard reload is what the at-least-once recovery covers.

### 5.7 `@facilis/ui` — removed`

**Removed (D-096).** The package, its two example apps (`examples/ui-gallery`,
`examples/design-lab`), its tarball vendoring and its `theme.css` contract are gone. Template v2
(D-090) generates Tailwind CSS v4 + Base UI with shadcn-style source copied into
`src/components/ui`, and projects created before D-090 are not supported. The rest of this
section documents the removed kit for the record.

The v1 base kit a project created before D-090 imported (D-055); it no longer exists. Plain CSS + role variables, no
Tailwind dependency and no theme props, so the components work in a project with no CSS
framework and can be copied into it.

- `@facilis/ui` exports `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Field`,
  `Table` (+ `TableHeader`/`TableBody`/`TableFooter`/`TableRow`/`TableHead`/`TableCell`/
  `TableCaption`), `Badge`, `Alert`, `Toaster` and `toast`. `Button` takes only
  `variant` (`primary|secondary|ghost|danger`) and `size` (`sm|md`); every other component
  takes its native props.
- `@facilis/ui/theme.css` is the only file with colour literals: complete `:root` (light),
  `[data-theme="light"]` and `[data-theme="dark"]` sets of `--color-base-*`,
  `--color-{primary,secondary,neutral,info,success,warning,error}(-content)`,
  `--radius-{selector,field,box}` and `--border-width`, plus the `.fc-*` rules. A project
  imports it once, sets `data-theme`, and overrides variables to rebrand; a new theme is
  another complete block. Deep customisation means copying the component source (shipped in
  the package) and its rules.
- `Field` wires `id`/`aria-describedby`/`aria-invalid` through context; `Toaster` is one
  instance with `toast()` helpers and a fixed 4 s auto-dismiss (no options by design).
- Page templates: `Page` (title/description/actions + content), `AuthShell` (centred auth
  card), `EmptyState` and `Spinner` (labelled or decorative). Navigation-aware shells
  (sidebar, user menu) stay in the project's `src/layouts/` because they need the router and
  the session; the kit only supplies the neutral templates the pages compose.

Patterns shipped on top of the primitives (all token-driven, SSR-renderable, copyable):
`Card`, `StatCard`, `Tabs`, `Dialog`, `Switch`, `Avatar`/`AvatarStack`, `Pagination`
(translatable summary + nav labels), `TableToolbar`, `Menu`, `Skeleton`, and the form pickers
`DatePicker` (calendar with optional time), `Combobox` (searchable select) and `TagPicker`.
`theme.css` holds only the token sets and the global base layer; each component owns its
stylesheet next to its source (`src/button.css`) and the build copies them into `dist` for
packed tarballs (D-060).

Content components round out the form surface (D-061). `MarkdownEditor` is Markdown with a
toolbar that transforms the real textarea selection (bold, italic, heading, lists, quote,
inline code, link), Ctrl/Cmd+B/I/K and Write/Preview tabs; `Markdown` is the exported
renderer for saved content. The renderer is a fixed subset — React elements only, raw HTML
shown as text, links limited to `http(s)`, `mailto:`, `#` and relative targets — so
untrusted text never injects markup. `TranslationsInput` edits one value per locale: locale
tabs with a filled/empty dot, config-driven locales plus add/remove (the default locale is
marked and cannot be removed), single or multiline. Its
`Translations = Readonly<Record<string, string>>` is the same shape `@facilis/i18n-db` stores,
so the client input and the server column agree without the kit depending on the server
package. All labels are injected (`labels` props) so `t()` covers them, and both components
take `id`/`aria-*` for `Field`.

### 5.8 `@facilis/time`

Zero-dependency date/time logic (D-056), built on `Intl` only:

- `formatDate`, `formatDateTime`, `formatTime` — localized formatting with explicit
  `{ locale, timeZone }` (runtime defaults only when omitted).
- `formatDateOnly`, `isValidDateOnly` — a calendar day is a `YYYY-MM-DD` string and never
  shifts across zones; the day domain is `0001-01-01 … 9999-12-31`.
- `dateOnlyOf`, `today` — the calendar day an instant falls on in a zone.
- `startOfDay`, `endOfDay` — the UTC `Date` of local 00:00 / 23:59:59.999, DST-aware
  (skipped and repeated midnights included).
- Types `DateInput`, `FormatOptions`, `DateOnlyFormatOptions`.

Invalid input throws (`TypeError` for wrong types, `RangeError` for bad dates/zones/instants);
ISO date-times without an explicit offset are rejected rather than read in the runtime zone.
There is nothing to configure.

### 5.9 `@facilis/i18n-db`

Opt-in database i18n (D-057), in two independent pieces:

- **Translated content fields** — `Translations = Readonly<Record<string, string>>`,
  `translatedText(name)` (Drizzle `jsonb` column), `translationsSchema` (Zod),
  `resolveTranslation(value, locale, fallbackLocale?)`, `normalizeLocale`, `matchLocale`,
  `parseAcceptLanguage` and `resolveUserLocale`. The project stores the per-language texts on
  the row, resolves the user's language (saved preference → `Accept-Language` → default) and
  maps rows through `resolveTranslation`, so only one language leaves the server.
- **Catalogue overlay (optional)** — `i18nMessages` plus `loadCatalog`/`loadCatalogs`/
  `saveCatalog`, `catalogQuery`/`parseCatalogLocales` for the project's explicit
  `defineAuthorizedHandler` route, and `hydrateCatalogs` on the client
  (`@facilis/i18n-db/client`, drizzle-free) merging database rows over `locales/*.json` per
  key.

---

### 5.10 `@facilis/storage`

Content-addressed binary storage for files uploaded by a generated app (D-053), wired into
the request runtime in D-116; opt-in at-rest encryption is D-117. Bytes are addressed by the
sha-256 hex digest of what the driver stores (plaintext normally, ciphertext when encryption is
on) and never stored in Postgres; a `facilis_files` row is the metadata, and a generated
`fileLinks` table attaches a row to its parent entity (§5.2).

**Configuration.** `facilis.config.ts` carries only the non-secret half; every key has a
default, so a project that never declares the section still gets working dev storage:

```typescript
storage: {
  driver: "local" | "s3"          // default "local" (dev); "s3" in production
  bucket: string | null            // required when driver is "s3"
  region: string | null            // required when driver is "s3"
  endpoint: string | null          // S3-compatible endpoint (R2, MinIO); null = AWS S3
  forcePathStyle: boolean | null   // null = driver default (virtual-hosted on AWS)
  maxUploadBytes: number           // default 10 MiB; hard cap 100 MiB
  tokenTtlSeconds: number          // default 300; max 24 h
  encryption: { enabled: boolean } // default false; key material is env-only (D-117)
}
```

| Concern | Decision |
|---|---|
| dev | `driver: "local"` writes `<project>/.facilis/binary/<hh>/<hash>` through the project filesystem, so the VFS/OPFS mirror persists it; the directory is self-ignored for git |
| prod | `driver: "s3"` — S3-compatible bucket, key `blobs/<hash>` (AWS S3, Cloudflare R2, MinIO; one SigV4 driver, no SDK) |
| secrets | environment only, never config: `FACILIS_S3_ACCESS_KEY_ID`, `FACILIS_S3_SECRET_ACCESS_KEY` (optionally `FACILIS_S3_SESSION_TOKEN`) and `FACILIS_STORAGE_SECRET`, the download-token HMAC key required in production; at-rest encryption adds the `FACILIS_STORAGE_ENCRYPTION_*` keys only when it is enabled (below) |
| boot | the runtime boot configures the driver (local in dev, S3 in production) and the `facilis-context` middleware exposes it as `ctx.storage`. A production boot with `driver: "local"` refuses storage (`storage_local_in_production`), an S3 driver without `FACILIS_S3_ACCESS_KEY_ID`/`FACILIS_S3_SECRET_ACCESS_KEY` is `storage_s3_credentials_missing`, production without the token secret is `storage_secret_missing`, and an unexpected driver-construction failure is `storage_boot_failed`. Each is a manifest warning, not a boot failure: `ctx.storage.available` is false and the file routes answer `storage_unavailable` (503) while the rest of the app keeps working |
| encryption | opt-in at-rest encryption: `storage.encryption.enabled` (default `false`, D-117); only the boolean is config, the key material is environment only (below). The app encrypts while it streams, before the driver sees the bytes — AES-256-GCM envelope encryption with a random 256-bit per-blob DEK wrapped by the project's KEK, 1 MiB chunks and a self-describing `FACILIS1` header (version 1, key id, chunk size, wrap nonce, wrapped DEK). There is no plaintext length or chunk count in the header: each chunk's AAD binds the full header, its index and a final-chunk flag, so a tampered, reordered or truncated blob fails authentication without the encryptor knowing the size up front (the encryptor holds at most one chunk) |
| encryption keys | environment only and required when encryption is enabled: `FACILIS_STORAGE_ENCRYPTION_KEY` (32-byte KEK, base64 or 64-character hex), `FACILIS_STORAGE_ENCRYPTION_KEY_ID` (optional active-key label, default `primary`; `/^[A-Za-z0-9._-]{1,64}$/`) and `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS` (optional JSON object `{ keyId: key }`, decrypt-only). Dev needs an explicit key too: there is no per-boot random KEK, because blobs would become undecryptable after a restart |
| encryption boot | enabled without a key is the `storage_encryption_key_missing` manifest warning; an unparseable key, an invalid key id or malformed retired-keys JSON is `storage_encryption_key_invalid`. Like the other `storage_*` warnings they never fail the boot: `ctx.storage.available` is false and the file routes answer `storage_unavailable` (503) while the rest of the app keeps working |
| drivers | package API: `createLocalStorage({ rootDir })`, `createS3Storage({ bucket, region, endpoint?, ... })`, `createEncryptedStorage({ driver, keys })` (the streaming envelope wrapper, D-117), `contentHash` and the token helpers; `put(source)`/`get(hash)` stream and `put` is idempotent per content hash |
| content addressing | the content hash is sha-256 of the **stored** bytes: plaintext when encryption is off, ciphertext when on. Encrypted mode therefore disables dedupe across uploads (equal plaintexts become distinct blobs) while `facilis_files.size` and `maxUploadBytes` stay the plaintext size |
| encryption downloads | with encryption on there is no S3 presigned redirect: the bucket holds only ciphertext, so `createEncryptedStorage` exposes no `signedGetUrl` and `sendStoredFile` always proxies through the app, decrypting while it streams. S3 server-side encryption (SSE-S3/SSE-KMS) is orthogonal and can be layered underneath — it protects the bucket, while this layer protects a copied body or a bucket reader |
| encryption rotation | set a new active key (`FACILIS_STORAGE_ENCRYPTION_KEY`/`_KEY_ID`) and move the previous one into `FACILIS_STORAGE_ENCRYPTION_RETIRED_KEYS`: every blob names the key that wrapped its DEK, so retired keys keep decrypting old blobs while new uploads use the active key. Enabling encryption on a project that already holds plaintext blobs refuses them (the decrypt step throws and the download fails — there is no plaintext fallback), so they must be re-uploaded; there is no online re-encryption, and D-053/D-116's immutable-body/no-GC rule is unchanged |
| streaming | the framework's storage/crypto/download path never buffers the file: `StorageApi.put` takes a byte stream and the drivers hash (and, when enabled, encrypt) while writing; `get` validates the hash and returns a byte stream. The platform multipart parser (`request.formData()`) materializes the uploaded form once, bounded by `maxUploadBytes`, before `storeUpload` streams the file into storage — uploading is not zero-copy for the whole request. `sendStoredFile` returns the plaintext stream as the response body with `content-length` from the plaintext size in `facilis_files`. The local driver hashes into a temp file and renames it into place; the S3 PUT stages the upload stream (ciphertext when encryption is on) to a `0600` temp file while hashing and counting it — SigV4 needs the payload hash and length — uploads from that file and deletes it. In encrypted mode the encryptor holds at most one 1 MiB chunk (one is held back to know whether it is final) |
| handler surface | `ctx.storage: StorageApi` (`kind`, `available`, `maxUploadBytes`, `put(source)/get(hash)` as byte streams, `exists/delete`, `buildDownloadUrl`, `verifyDownloadToken`, optional `presignedGetUrl` — absent when encryption is on); a route that declares a `form` schema instead of a `body` gets the parsed multipart body as `ctx.form` |
| helpers | `@facilis/nitro/storage` exports `storeUpload({ event, db, storage, auth, file })` — enforces `maxUploadBytes` from the file's size, streams the file into storage after the platform parsed the multipart form once, inserts the `facilis_files` row and returns `{ id, name, mime, size, url }` (or a `Response` rejection) — and `sendStoredFile({ db, storage, fileId, token, tenantId, responseName? })`, which verifies the token and returns the plaintext as a streamed response body with `content-length` from the stored plaintext size (dev, and any encrypted deployment) or redirects to a driver-presigned S3 GET (prod with encryption off) |
| template routes | `POST /api/todos/:id/files` (session + `storeUpload`, then the route inserts the generated link row), `DELETE /api/todos/:id/files/:fileId`, and `GET /api/files/:id?token=…` (permission `[]`, token-only); `GET /api/todos` carries each todo's attachments with a freshly signed URL (`null` when no driver booted) |
| access | the download route verifies a short-lived HMAC token carrying `fileId`, `tenantId`, `subject` and `expiresAt` (`buildDownloadUrl`, default 5 min). GET is token-only so `<img src>` and shared links work without a cookie; every mutation stays session-authenticated |
| multipart contract | `form` and `body` are mutually exclusive on `defineAuthorizedHandler`; a multipart request is consumed once by the wrapper, and the route validates fields with Zod while `maxUploadBytes` is enforced before the body is stored. A rejected upload is `file_too_large` (413) or `invalid_input` (400) |
| response headers | the stored mime is served with `x-content-type-options: nosniff`, an attachment `content-disposition`, `content-security-policy: sandbox` and `cache-control: private`, so user content never renders as a privileged same-origin page |
| errors | `file_too_large` (413) and `storage_unavailable` (503) join the core error registry (§7.4); the rest of the API is unaffected when storage is down |
| metadata | `facilis_files` — RESTRICTIVE `tenant_isolation` plus the PERMISSIVE `facilis_files_tenant_access` insert gate (a restrictive policy alone denies `facilis_app` the insert, D-008) — and the generated `fileLinks(parent, …)` tables, each with a restrictive tenant policy and the permissive `parent_access` inheritance (§5.2) |
| cleanup | no GC yet: bodies are immutable and deduplicated in plaintext mode (encrypted blobs are unique per upload), so orphans cost space only for content no longer referenced |

### 5.11 `@facilis/analyze`

Zero-build static analysis of the project's declarative DSL (D-092). It reads a path → source
map with an injected `Parser` and returns the fact model — routes, config,
tables/columns/policies, FK and `relations()` edges, pages/consumers, per-file module facts
(imports, literal `t()` keys, bare calls), locale catalogs — plus diagnostics and the single
project graph, **without executing project code**. The main entry is browser-safe and has no
runtime parser dependency; adapters live on subpaths: `./node` (oxc-parser native/wasm, CLI
and CI) and `./fs` (the Node filesystem loader, no parser). The IDE worker supplies the browser
wasm parser; `@facilis/nitro` supplies `rolldown/utils` because the generated project's Vite
config runs inside the WebContainer, where only the bundler's oxc is proven to load. Unknown
values are explicit (`null`/unknown entries, never defaults), the DSL is forced by the
`defineAuthorizedHandler`/`defineConfig`/`pgTable`/`api()`/`t()` contract, and the runtime
wrapper remains the security boundary. Used by the IDE project graph and patch validation, the
AI validator, and the Nitro manifest/OpenAPI facts. The browser IDE supplies the installed framework declarations it would otherwise lack by inlining `@facilis/auth` and `@facilis/db`'s source at build time (D-130), so re-exported framework tables and their edges reach the graph without a `node_modules` crawl.

## 6. The `/__facilis/manifest` Endpoint

### 6.1 Transport

| Property | Value |
|---|---|
| Method | `GET` |
| Path | `/__facilis/manifest` |
| Availability | `NODE_ENV` is `development`/`test` (anything else, including unset, is production → 404; D-146) |
| Auth | None (dev-only, origin-locked) |
| Content-Type | `application/json; charset=utf-8` |

**Query parameters:**

- `sections` — comma-separated: `config,blocks,routes,schema,i18n,meta`
- `since` — revision hash for 304 short-circuit
- `format` — `"full"` (default) or `"summary"`

**Phase 1 note:** `format=summary` returns the compact envelope
`{ revision, generatedAt, sections, summary, warnings }` — the summary is not a
`Partial<FacilisManifest>`, so it is not nested under `manifest`. The full form is
unchanged.

**Response headers:**

- `ETag: W/"<revision>"`
- `Cache-Control: no-cache`
- `X-Facilis-Revision: <revision>`
- `X-Facilis-Partial: true` (if any section failed)

### 6.2 Response Envelope

```typescript
interface FacilisMetaResponse {
  revision: string
  generatedAt: string          // ISO
  sections: FacilisSection[]
  manifest: Partial<FacilisManifest>
  warnings: ManifestWarning[]
}
```

### 6.3 Companion Endpoints

| Endpoint | Purpose | Size |
|---|---|---|
| `/__facilis/manifest/revision` | Cheap freshness poll (60 bytes) | `{ revision, generatedAt }` |
| `/__facilis/health` | Boot detector | `{ status, bootedAt, revision }` |
| `/__facilis/dev/schema` | Code ↔ live schema + typed drift (§11.1, D-083) | `{ code, live, drift, warnings }` |
| `/__facilis/dev/query` | Read-only SQL console (§11.2, D-097) | `{ columns, rows, rowCount, elapsedMs, truncated }` |
| `/__facilis/dev/view` | Create/replace a view; optional declared permission (§11.2, D-097/D-098) | `{ name }` |

### 6.4 Error Model

| Status | When |
|---|---|
| 200 | Manifest returned (full or partial) |
| 304 | `If-None-Match` matches current revision |
| 400 | Invalid `sections` value |
| 403 | Origin mismatch |
| 404 | production (`NODE_ENV` not `development`/`test`, D-146) |
| 503 | Facilis module failed to start |

**Partial failure is 200, not 500.** A broken `db/schema.ts` emits a warning and omits the `schema` section.

### 6.5 Revision Hashing

`revision` = SHA-1 of concatenated hashes of:

- `facilis.config.ts` content
- Sorted list of `db/schema.ts` and its imports
- Generated OpenAPI spec JSON
- Sorted `node_modules/*/manifest.*` for block packages — reserved, always empty (D-131)
- Sorted `locales/*.json`

No file watchers required. Recomputed on every request; clients use ETag.

### 6.6 Caching Strategy

- **MVP:** Studio polls `/__facilis/manifest/revision` every 2s (and on `visibilitychange`). Full fetch only when revision changes.
- **Phase 4.5:** WebSocket push via `server/routes/_ws.ts`. Nitro broadcasts `facilis:invalidated` on file change.

### 6.7 Boot Lifecycle

| State | `/__facilis/manifest` | Studio |
|---|---|---|
| Vivari not booted | unreachable | Show "Booting…" |
| Vite starting | unreachable | Retry with backoff |
| Vite up, Nitro worker starting | 503 or unreachable | Retry with backoff |
| Vite up, schema broken | 200 + warning | Entity explorer error banner; AI degrades |
| Vite up, OpenAPI off | 200 + warning | Visualizer shows "enable openAPI" |
| Vite up, all good | 200 full | All panels live |

### 6.8 Security

- Dev-only guard: production (`NODE_ENV` not `development`/`test`) → 404 (D-146)
- Origin allowlist: only Vivari preview origin
- **No secrets** in the manifest. `facilis.config.ts` must never contain them.

### 6.9 Route Metadata Extraction

`x-db-tables` and `x-db-columns` are emitted by `defineAuthorizedHandler` via `defineRouteMeta`.

**Phase 0 result (verified, 2026-10-25): Nitro's scanner only accepts a *top-level* `defineRouteMeta` call. A call inside the wrapper is invisible to it, so the native path does not work (A16 = fail).** `@facilis/nitro` therefore ships a framework-owned static pass that reads the wrapper config into a virtual module, plus a facade that merges it into Nitro's generated spec and serves it at `/_openapi.json`. Nitro's own spec stays intact on an internal dev-only route (`/_facilis/openapi.json`).

**Implementation (2026-11-04, D-092/D-093).** The pass is `@facilis/analyze`'s route facts, not
a Nitro-local scanner: `packages/nitro/src/route-metadata.ts` maps `RouteFact[]` to the
manifest/OpenAPI contract and `packages/nitro/src/rolldown-parser.ts` injects `rolldown/utils`
as the parser. That parser choice is deliberate: the generated project's Vite config is loaded
inside the WebContainer with `--configLoader native`, where only the bundler's oxc is proven to
load, so `@facilis/nitro` must not pull `@facilis/analyze/node` (oxc-parser) into the VM. The
same facts list route files even when the wrapper is missing (integrity view), update when any
project source file changes (config and imported consts are analyzer input), and never guess:
an unreadable field becomes `unresolved` and is omitted from the operation (plus an
`x-facilis-warning`) instead of being published. The metadata virtual module is owned by the
`facilis()` **Vite plugin**, not by a Nitro virtual module — inside the Nitro environment,
Nitro's virtual plugin resolves that id before user plugins and served stale metadata across
edits (HMR broke). The facade answers `200` with an `openapi-unavailable` warning when Nitro's
generator is disabled, and `404` in production unless `openAPI.production` is enabled.
Behavior changes vs the old scanner: same-file and one-hop imported consts are resolved;
wrapper-less routes are listed with `security: "unknown"`; permissions are arrays; methods
outside core's five are omitted with a warning; there is no `defineRouteMeta` fallback.
`x-cross-site: true` (D-141) is emitted only when the wrapper declares `crossSite: true`; the
same value appears as `RouteMeta.crossSite`. A `crossSite` route with a non-empty permission is
reachable only with a Bearer token, so the operation declares `security: [{ bearerAuth: [] }]` and
the document gains `components.securitySchemes.bearerAuth` only when such a route exists (D-142).

---

## 7. Type Reference

### 7.1 `FacilisConfig`

```typescript
interface FacilisConfig {
  release: { ref: string }
  db: {
    mode: "pglite" | "postgres" | "json"   // D-068: an env URL wins over this; "json" not implemented
    migrationsDir: string
    tenantColumns: string[]
    ownerColumns: string[]
  }
  i18n: { defaultLocale: string; locales: string[] }
  nitro: Record<string, unknown>     // pass-through Nitro options; framework defaults underneath (D-034)
  auth: {
    permissions: string[]
    roles: Record<string, string[]>      // role name → permission list; "*" is wildcard
    defaultRole: string                  // assigned on registration
    sessionDurationMs: number
    sso: {                               // D-120; every key has a default
      providers: SsoProvider[]           // oidc | oauth2 | saml; secrets only as ENV VAR names
      failureRedirect: string            // same-origin path, default "/login"
      stateTtlMs: number                 // login-attempt lifetime, default 10 min
    }
    verification: {                      // D-156; every key has a default
      enabled: boolean                   // blueprint login requires a verified email; default false
      tokenTtlMs: number                 // link lifetime, default 86400000 (24 h), max 30 days
      successRedirect: string            // same-origin path, default "/login" (?verified=1 appended)
      failureRedirect: string            // same-origin path, default "/login" (?verify_error=code appended)
    }
    apiClients: {                        // D-142; every key has a default
      enabled: boolean                   // expose POST /api/auth/token, default false
      tokenTtlMs: number                 // access-token lifetime, default 3600000
      rateLimit: {                       // D-143; token exchanges per client id
        windowMs: number                 // fixed window length, default 60000
        maxRequests: number              // exchanges allowed in a window, default 30
      }
    }
  }
  jobs: {
    maxConcurrent: number      // attempts executing at the same time (default 2)
    maxAttempts: number        // total attempts per job; 1 = no retry (default 1)
    retryDelayMs: number       // fixed delay before a retry (default 5000)
    timeoutMs: number          // wall-clock bound of one attempt (default 30000)
    pollIntervalMs: number     // scheduler tick, minimum 100 (default 1000)
    persist: boolean           // keep the queue in facilis_jobs (default true)
  }
  storage: {                   // D-116/D-117; every key has a default, secrets stay in env (§5.10)
    driver: "local" | "s3"     // default "local"; "s3" is required in production
    bucket: string | null      // required with driver "s3"
    region: string | null      // required with driver "s3"
    endpoint: string | null    // S3-compatible endpoint (R2, MinIO); null = AWS S3
    forcePathStyle: boolean | null  // null = driver default
    maxUploadBytes: number     // default 10 MiB; hard cap 100 MiB
    tokenTtlSeconds: number    // download-token lifetime, default 300 s; max 24 h
    encryption: { enabled: boolean }  // at-rest encryption, default false; keys stay in env (D-117)
  }
  logging: {                   // D-119; every key has a default, the sink stays in env
    level: "debug" | "info" | "warn" | "error"   // default "info"; FACILIS_LOG_LEVEL overrides
    access: boolean            // one access entry per authorized request, default true
    errors: boolean            // server-side error entries, default true
    includeUserAgent: boolean  // default false
    trustProxy: boolean        // trust x-forwarded-for, default false
  }
  security: {                  // D-141; request-origin policy for unsafe methods
    trustedOrigins: string[]   // absolute http(s) origins allowed as same-site callers; default []
  }
}
```

### 7.2 `BlockManifest`

**Reserved (D-131).** No package ships a block manifest any more; the type stays in the
manifest contract, whose `blocks` section is always empty until a manifest revision drops it.

```typescript
interface BlockManifest {
  name: string
  version: string
  category: "data" | "form" | "layout" | "auth" | "feedback" | "media" | "other"
  description: string
  propsSchema: Record<string, unknown>       // JSON Schema
  apiHints?: ApiHint[]
  i18nKeys?: string[]
  requiredPermissions?: string[]
  resourceBound?: boolean
}

interface ApiHint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string                                // OpenAPI path template
  role: "reads" | "writes"
}
```

### 7.3 `FacilisManifest`

```typescript
interface FacilisManifest {
  framework: { coreVersion: string; nitroVersion: string }
  project: { config: FacilisConfig }
  blocks: BlockManifest[]                     // reserved, always empty (D-131)
  routes: RouteMeta[]
  schema: SchemaSnapshot
  i18n: {
    defaultLocale: string
    catalogs: Record<string, Record<string, string>>
  }
}

interface RouteMeta {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  operationId?: string
  summary?: string
  description?: string                        // one English sentence, ≤120 chars, from the wrapper config (AST pass; D-129)
  permission?: string | string[]              // string[] mirrors the handler config
  dbTables: string[]                          // empty = explicit "no DB"
  dbColumns: string[]                         // format: "table.column"
  security: "required" | "optional" | "public" | "unknown"
  crossSite?: boolean                         // true = declared exposed to other origins (D-141; Bearer when a permission is set, D-142)
  sourceFile?: string                         // for editor jump-to
}

interface SchemaSnapshot {
  tables: TableSnapshot[]
}

interface TableSnapshot {
  name: string
  rlsEnabled: boolean
  columns: ColumnSnapshot[]
  foreignKeys: ForeignKeySnapshot[]
  policies: PolicySnapshot[]
  scopeColumn?: { name: string; kind: "tenant" | "owner" }
}

interface ColumnSnapshot {
  name: string
  type: string
  notNull: boolean
  default: string | null
  isPrimaryKey: boolean
  isUnique: boolean
}

interface ForeignKeySnapshot {
  columns: string[]
  targetTable: string
  targetColumns: string[]
  onDelete?: "cascade" | "set null" | "restrict" | "no action"
  onUpdate?: "cascade" | "set null" | "restrict" | "no action"
}

interface PolicySnapshot {
  name: string
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL"
  using: string | null
  withCheck: string | null
  sql: string
}
```

**Note:** `PolicySnapshot.roles` field was removed in v1.1 — app roles are evaluated via `current_setting('app.roles')`, not Postgres roles.

### 7.4 `defineAuthorizedHandler`

```typescript
interface AuthorizedHandlerConfig<Body = void, Query = void, Params = void, Form = void> {
  permission: string | string[]               // [] for public routes
  body?: ZodSchema<Body>                      // JSON body; mutually exclusive with form
  form?: ZodSchema<Form>                      // multipart fields (name → string | File); D-116
  query?: ZodSchema<Query>
  params?: ZodSchema<Params>
  dbTables: string[]                          // REQUIRED: every table/view the handler may access (D-157)
  dbColumns?: string[]
  rawSql?: boolean                            // allow db.execute (raw SQL) in this route; default false (D-157)
  description?: string                     // one English sentence, ≤120 chars (about two lines); source documentation, never a t() key (D-129)
  crossSite?: boolean                      // true = exposed to other origins; with a permission it requires a Bearer token (D-142)
  originCheck?: "enforce" | "skip"         // "skip" only for framework protocol endpoints (SAML ACS); default enforce (D-142)
  rateLimit?: { windowMs: number; maxRequests: number } // per-client, per-route fixed window (D-152); skipped when no client address
}

**`dbTables` is enforced (D-157).** The array declares **every** relation the handler may touch through `ctx.db`, `ctx.sudo` and `ctx.system`: tables and views, by SQL name (a view is declared by its own name, D-097/D-098; a definer view keeps its declared permission as the gate). It is not documentation: `@facilis/analyze` follows the handler's project-local helper calls and reports an undeclared relation as `route-table-undeclared` (error), a declared-but-unused one as `route-table-unused` (warning), an unresolvable/dynamic relation as `route-table-unresolved` (error) and `db.execute` without `rawSql: true` as `route-raw-sql` (error); the CI route gate (D-154) runs the pass on the shipped examples and the AI validator rule 18 `route-table-declared` rejects a patch that breaks it. At runtime the wrapper **guards** the scoped client and the elevation callbacks: a relation outside the declared set fails closed with `500 table_not_declared`, raw SQL without the flag with `500 raw_sql_not_allowed`, and the violation is audited (`route:table_access`); inside `ctx.sudo`/`ctx.system` the observed tables must also be within the elevation's `tables`, whose `succeeded` audit entry records the observed set. Package calls are opaque statically (the runtime is the authority).

interface AuthorizedHandlerContext<Body, Query, Params, Form = void> {
  auth: AuthContext | null                    // null only on permission: [] routes
  body: Body
  form: Form                                  // validated multipart fields when declared
  query: Query
  params: Params
  db: PolicyScopedDatabase                    // pre-scoped, never raw
  sudo: SudoHandler                           // audited elevation, §8.4.5; requires a session
  system: SystemHandler                       // audited elevation for public/bootstrap routes
  jobs: JobsApi                               // server-only job queue (D-107), no HTTP surface
  storage: StorageApi                         // binary storage, §5.10; degrades when unavailable
  log: FacilisLogger                          // request logger (D-119)
  requestId: string                           // correlation id, set by the logging middleware
}

interface SudoHandler {
  <T>(options: {
    operation: string                         // stable label, never user input
    reason: string                            // why, never user input
    tables: string[]                          // non-empty subset of the route's dbTables
  }, fn: (systemDb: PolicyScopedDatabase) => Promise<T>): Promise<T>
}

interface SystemHandler {
  // Same contract plus the actor; no session required (registration/bootstrap).
  <T>(options: {
    actor: string                             // "system:<job>"
    operation: string
    reason: string
    tables: string[]
  }, fn: (systemDb: PolicyScopedDatabase) => Promise<T>): Promise<T>
}

interface AuthContext {
  userId: string
  roles: string[]
  permissions: string[]                       // already expanded from roles
  sessionHash?: string                        // SHA-256 of the session id (sudo audit, D-099)
  // No tenant: it is the deployment's, set as app.tenant_id for every request and
  // enforced by RLS (D-040), so neither the session nor the request can widen it.
}

interface FacilisLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  /** Appends an audit entry now; never filtered by the diagnostic level (D-119). */
  audit(event: {
    operation: string                         // stable label, never user input
    outcome?: "succeeded" | "failed"
    errorCode?: string
    reason?: string
    tables?: string[]
    details?: Record<string, unknown>         // redacted/capped by the runtime
  }): void
}

interface FacilisHandlerEvent {
  context: { auth?: AuthContext | null; params?: Record<string, string>;
    facilis?: { defaultTenantId?: string } }   // no db: the raw client is not on the handler surface
  req: FacilisRequest
  res?: FacilisResponse
}

function defineAuthorizedHandler<B, Q, P>(
  config: AuthorizedHandlerConfig<B, Q, P>,
  handler: (event: FacilisHandlerEvent, ctx: AuthorizedHandlerContext<B, Q, P>) => Promise<unknown> | unknown,
): EventHandler
```

**No raw client on the handler surface (D-099).** The wrapper receives the full event (with
`context.facilis.db`), captures the root client, and calls the handler with a `FacilisHandlerEvent`
whose `facilis` carries only `defaultTenantId`. The handler has exactly two DB surfaces: the
policy-scoped `ctx.db` (session/tenant GUCs and RLS) and the audited `ctx.sudo`/`ctx.system`
elevation; it cannot reach a policy-free client. Using the raw client (or importing `createDb`)
is reported by the analyzer as `route-direct-db` — "not recommended" made visible in the
manifest.

**Request-origin gate and media type (D-141).** Before the permission check, an unsafe method
(POST/PUT/PATCH/DELETE) must pass the origin gate: `Sec-Fetch-Site` is authoritative when present
(`same-origin`/`none` allowed, `same-site` only for an origin in `config.security.trustedOrigins`,
`cross-site` rejected), otherwise `Origin` must match the request `Host` or a trusted origin; a
missing `Origin` is a non-browser client and is allowed, `null` is rejected. A rejection is
`403 forbidden`. A route with a `body` schema accepts only `application/json`, one with `form`
only `multipart/form-data`; anything else is `415 unsupported_media_type`, decided before the
body is read. `crossSite: true` skips the gate for that route (an exposed API): with
`permission: []` it is anonymous, with a permission it is reachable only with a Bearer token
(D-142) — a session cookie never crosses origins. `originCheck: "skip"` is the same exemption for
framework protocol endpoints that validate the request themselves (the SAML ACS POST); an
application route must not use it.

**Logging on the context (D-119).** The wrapper records exactly one access entry for every
request exit path (401/403, 400, 503, a handler result or a throw) with method, pathname, status,
duration, request id and the session hash — never a header, a cookie or a body. An unexpected
failure is recorded server-side (name/message/stack) while the client still gets only
`{ code: "internal_error" }`. Routes add their own lines and audit events through
`ctx.log`; audit entries are never level-filtered and the sudo trail is bridged into the same
sink from `@facilis/db` (D-099). The output is JSON Lines files
(`<project>/.facilis/logs/`) or stdout — **there is no HTTP endpoint that serves logs**
(D-119).

**Multipart uploads (D-116).** `body` and `form` are mutually exclusive: a route declares one
schema and the wrapper parses exactly that representation (a multipart request is consumed
once). With `form`, the wrapper reads `req.formData()`, collapses repeated names to arrays,
validates against the schema and hands the parsed fields to the handler as `ctx.form`; a
missing or malformed multipart body is `400 invalid_input`. The wrapper caps the body bytes
before parsing (D-153): multipart is bounded by `storage.maxUploadBytes + 1 MiB` (1 MiB when
storage is unconfigured) and an over-cap body is `413 payload_too_large`. `maxUploadBytes` is
still enforced by `storeUpload` before the bytes are stored, so a single oversized file is
`413 file_too_large`. Uploading is not zero-copy: the platform's `formData()` materializes the
multipart form once (bounded by the wrapper cap) before `storeUpload` streams the file into
storage; the framework's storage/crypto path itself never buffers the whole file (D-117).

**Binary storage on the context (D-116).** `ctx.storage` is the ready `StorageApi` from
§5.10 (`available: false` when the boot degraded). Routes never touch a driver directly: they
call `storeUpload`/`sendStoredFile` from `@facilis/nitro/storage` (§5.10) or use
`ctx.storage.put/get` for lower-level work — `put` takes a byte stream and `get` returns one
(D-117). Access control is the route's job; the generated `fileLinks` row is inserted by the
route through `ctx.db`, never by the framework helper.

**Public token-only GET (D-116).** `permission: []` is reserved for genuinely public routes.
The sanctioned data-bearing case is the download route `GET /api/files/:id?token=…`: the
short-lived HMAC token is the credential, the handler verifies it with `sendStoredFile` (which
also streams or redirects) and no session is required, so an `<img src>` and a shared link
work. With at-rest encryption on (D-117) there is no presigned path: the handler always proxies
and decrypts while streaming. A blob stored before encryption was enabled is refused on decrypt
— the download fails instead of ever returning plaintext — so it must be re-uploaded. Every
mutation — upload, delete, attach — stays session-authenticated. The
API error registry is closed (O-002): `file_too_large` is `413`, `payload_too_large` is `413`
(a body over the wrapper's byte cap, D-153), `storage_unavailable` is `503`,
`unsupported_media_type` is `415`, `too_many_requests` is `429` (D-143, D-152) and
`email_unverified` is `403` (correct password, unverified address — D-156).

### 7.5 `AIResponse`

```typescript
interface AIResponse {
  reasoning: string
  files: FilePatch[]
  requires_confirmation: boolean
  notes?: string
  blocked_on?: {
    needs_file?: string[]
    needs_user_input?: string
  }
}

interface FilePatch {
  path: string
  action: "create" | "update" | "delete"
  content?: string                            // whole-file for MVP
}
```

### 7.6 `ValidationResult`

```typescript
interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

interface ValidationError {
  rule: string
  severity: "error" | "warning"
  file: string
  line?: number
  column?: number
  message: string
  fix_hint: string
  excerpt?: string
}
```

### 7.7 `ReleasePreview`

```typescript
interface ReleasePreview {
  from: GitRef
  to: GitRef
  generatedAt: string
  schema: SchemaDiff
  api: ApiDiff | null
  security: SecurityDiff
  breaking: BreakingChange[]
  warnings: ReleaseWarning[]
}

interface GitRef {
  kind: "commit" | "branch" | "tag"
  ref: string
  oid: string
}

interface SchemaDiff {
  statements: MigrationStatement[]
  summary: {
    addedTables: number; droppedTables: number
    addedColumns: number; droppedColumns: number; alteredColumns: number
    addedPolicies: number; droppedPolicies: number; alteredPolicies: number
  }
}

type RiskClass = "safe" | "careful" | "destructive" | "breaking"

interface MigrationStatement {
  sql: string
  kind:
    | "add_table" | "drop_table"
    | "add_column" | "drop_column" | "alter_column"
    | "add_index" | "drop_index"
    | "add_policy" | "drop_policy" | "alter_policy"
    | "add_fk" | "drop_fk"
    | "other"
  risk: RiskClass
  affectedTable: string | null
  affectedColumns: string[]
  reason: string
}

interface ApiDiff {
  added: ApiRouteRef[]
  removed: ApiRouteRef[]
  changed: { before: ApiRouteRef; after: ApiRouteRef; fields: string[] }[]
}

interface ApiRouteRef {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  permission?: string | string[]
  // Optional since D-086: a route derived from a filename at an old ref cannot know its
  // tables; an omitted field means "unknown at this ref", never "no tables".
  dbTables?: string[]
  sourceFile?: string // additive, for jump-to
}

interface SecurityDiff {
  policiesAdded: PolicySnapshot[]
  policiesDropped: PolicySnapshot[]
  policiesChanged: PolicyChange[]
  rlsDisabled: { table: string }[]
}

interface PolicyChange {
  table: string
  policy: string
  before: PolicySnapshot
  after: PolicySnapshot
  direction: "narrowed" | "broadened" | "unknown"
}

interface BreakingChange {
  kind: "dropped_table_in_use" | "dropped_column_in_use" | "widened_type_mismatch"
  table: string
  column?: string
  routes: { method: string; path: string }[]
  message: string
}

interface ReleaseWarning {
  kind: "pending_migrations_on_target" | "destructive_without_backfill" | "policy_broadened"
  message: string
  related?: string
}
```

### 7.8 Studio-Only Types

```typescript
interface ProjectRef {
  id: string                                  // SHA-1(remoteUrl + "#" + branch)
  remoteUrl: string
  branch: string
  displayName: string
  lastOpened: string
}

interface OpenProject extends ProjectRef {
  status: "cloning" | "booting" | "ready" | "dirty" | "error"
  opfsPath: string
  gitState: {
    head: string
    ahead: number
    behind: number
    uncommittedFiles: number
  }
  vivariId: string | null
  openFiles: string[]
  activeFile: string | null
  manifest: FacilisManifest | null
  manifestStaleAt: string | null
}

interface GitHostCredential {
  host: string
  tokenEncrypted: ArrayBuffer                // WebCrypto AES-GCM
  username: string | null
}

interface ProjectRegistry {
  version: 1
  projects: ProjectRef[]
  credentials: GitHostCredential[]
  lastActiveProjectId: string | null
}
```

### 7.9 Job API

The background-job contract (D-107; design reference [`JOBS.md`](./JOBS.md)). A job is an
independent, server-side unit of work: it receives serialized data, always runs in a system
context (its own transaction as `facilis_system`, audited), and returns serialized data. The
queue is reachable only from server code, so it is never an HTTP surface of its own.

```typescript
interface FacilisJobsConfig {
  maxConcurrent: number      // attempts running at the same time (default 2)
  maxAttempts: number        // total attempts per job including the first; 1 = no retry (default 1)
  retryDelayMs: number       // fixed delay before a retry (default 5000)
  timeoutMs: number          // wall-clock bound of one attempt (default 30000)
  pollIntervalMs: number     // scheduler tick, minimum 100 (default 1000)
  persist: boolean           // keep the queue in facilis_jobs (default true)
}

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

type JobJson = null | boolean | number | string | JobJson[] | { [key: string]: JobJson }

interface JobRunContext<Input> {
  jobId: string              // the id enqueue returned
  name: string
  attempt: number            // 1-based attempt number of this instance
  data: Input                // the parsed input
  signal: AbortSignal        // aborted on cancellation, timeout or shutdown
  db: PolicyScopedDatabase   // system-scoped transaction (facilis_system)
}

interface JobDefinition<Input = unknown, Output = unknown> {
  name: string               // enqueue key, unique across the registry
  input: z.ZodType<Input>    // parsed at enqueue and before every attempt
  output: z.ZodType<Output>  // parsed before the result is persisted
  tables?: readonly string[] // sudo-audit tables; [] when the job reads none
  maxAttempts?: number       // per-job override of jobs.maxAttempts
  timeoutMs?: number         // per-job override of jobs.timeoutMs
  run: (ctx: JobRunContext<Input>) => Promise<Output> | Output
}

function defineJob<Input, Output>(
  definition: JobDefinition<Input, Output>
): JobDefinition<Input, Output>
function isJobDefinition(value: unknown): value is JobDefinition
function serializeJobData(value: unknown, code: JobErrorCode): JobJson

class JobError extends Error {
  code:
    | "job_unknown"
    | "job_invalid_input"
    | "job_invalid_output"
    | "job_invalid_schedule"
    | "job_unavailable"
}

interface JobRecord {
  id: string
  name: string
  status: JobStatus
  input: JobJson
  output: JobJson | null     // only for "succeeded"
  error: string | null       // last failure message (server-only, truncated)
  attempts: number
  maxAttempts: number
  timeoutMs: number
  runAt: string              // ISO-8601
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

interface JobListOptions {
  status?: JobStatus | readonly JobStatus[]
  name?: string
  limit?: number             // default 50, capped at 200
}

interface JobQueueStats {
  queued: number
  running: number
  succeeded: number
  failed: number
  cancelled: number
  maxConcurrent: number
}

interface EnqueueJobOptions {
  runAt?: string | Date      // absolute instant; exclusive with delayMs
  delayMs?: number           // relative delay in milliseconds
}

interface JobsApi {
  enqueue(name: string, data: unknown, options?: EnqueueJobOptions): Promise<{ id: string }>
  get(id: string): Promise<JobRecord | null>
  list(options?: JobListOptions): Promise<JobRecord[]>
  queue(): Promise<JobRecord[]>    // status "queued", runAt ascending
  running(): Promise<JobRecord[]>  // status "running"
  cancel(id: string): Promise<boolean>
  stats(): Promise<JobQueueStats>
  bindScope?(scope: PolicyScopedDatabase): JobsApi  // framework plumbing, see below
}
```

`defineJob` validates the authored definition at module load (name pattern, Zod schemas, positive
integer overrides); `isJobDefinition` is the structural guard the registry uses on a scanned
module. Both the input and the result cross a JSON round-trip (`serializeJobData`): what the queue
stores is exactly what the job receives and what `get`/`list` return. `JobsApi` is on the
authorized-handler context (`ctx.jobs`, §7.4) and on the request event's
`context.facilis.jobs`; it has no HTTP surface of its own. A route always has `ctx.jobs`: if the
runtime failed to boot (the `jobs_boot_failed` manifest warning) the context middleware omits
`facilis.jobs` and the handler receives an unavailable API whose every call rejects with
`JobError("job_unavailable")` — a route that never touches jobs keeps serving, and a route that
calls the API handles the coded failure instead of a framework-wide 500. The unavailable
implementation itself is internal; only the code is public through `JobError`. The route wrapper
binds `ctx.jobs` to the request's policy-scoped transaction (`bindScope`, framework plumbing):
PGlite is a single connection, so a queue call that opened its own transaction would deadlock the
request waiting for it. A job attempt is the opposite case — it runs outside a request and opens
its own system transaction. Every attempt
runs through `runAsSystem` with actor `system:job:<name>` and the definition's `tables` —
possibly `[]` — so the job body always sees a system-scoped transaction (§8.4.5).

---

## 8. Security Model

### 8.1 Defense-in-Depth Layers

| Layer | Enforces | Where |
|---|---|---|
| **1. Auth middleware** | Who is the user | Nitro global → `event.context.user` |
| **2. Route RBAC** | Can this role call this endpoint | `defineAuthorizedHandler({ permission })` |
| **3. RLS** | Which rows are visible | Postgres policies, evaluated against `current_setting('app.*')` |
| **4. App scoping** | Developer forgot a WHERE | `drizzle-policy` wrapper |
| **5. Input validation** | Malformed/injected input | Zod schemas via `nitro-openapi-schemas` |

### 8.2 Route RBAC Pattern

`defineAuthorizedHandler` is the **only** documented way to create a route. It enforces:

- `permission` check (403 before body validation)
- request-origin gate on unsafe methods (403 when cross-site; D-141)
- strict media type on body/form routes (415 `unsupported_media_type`; D-141)
- `crossSite: true` with a permission is exposed and Bearer-authenticated (D-142); a protocol endpoint may set `originCheck: "skip"` (SAML ACS only)
- body byte caps before parsing (D-153): JSON 1 MiB, multipart `storage.maxUploadBytes + 1 MiB` (1 MiB fallback); `content-length` pre-check plus a streamed counter, over the cap → `413 payload_too_large`
- optional per-route fixed window (`rateLimit`) keyed by the middleware's client address and the route path, evaluated before permissions and body parsing → `429 too_many_requests` with `retry-after` (D-152); a deployment that resolved no client address skips it rather than sharing one window
- Input validation against Zod schemas (400 on failure)
- `ctx.db` is the policy-wrapped client (never raw)
- `dbTables` required (compile-time enforcement)
- OpenAPI generated with `x-permission` and `x-db-tables`

### 8.3 RLS Auto-Generation

`@facilis/db`'s migration plugin inspects the Drizzle schema and **automatically appends** for any table with a column matching `config.db.tenantColumns` or `ownerColumns`:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING (<scope_column> = current_setting('app.<scope_column>')::uuid);
```

Declare the tenant column with `tenantColumn()` from `@facilis/db`: it is the same `uuid`, with
the `DEFAULT` that reads the policy-scope GUC, so inserts never name the tenant (D-040).

### 8.4 Role Definition & Assignment

Three phases, three actors.

#### 8.4.1 Phase 1 — Definition (developer, code, committed)

Roles and permissions are **declared in `facilis.config.ts`**. They are code: reviewable, diffable, versionable.

```typescript
// facilis.config.ts
import { defineConfig } from "@facilis/core"

export default defineConfig({
  auth: {
    permissions: [
      "todos:read",
      "todos:write",
      "users:read",
      "users:manage",
      "admin:*",
    ],

    roles: {
      admin:   ["*"],                                  // wildcard: all permissions
      manager: ["todos:read", "todos:write", "users:read"],
      user:    ["todos:read", "todos:write"],
      viewer:  ["todos:read"],
    },

    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
  },
})
```

**Rules:**

- Every permission listed in a role **must** exist in `permissions[]`. Otherwise `defineConfig` throws at boot.
- `"*"` is a wildcard: the role has every permission.
- `defaultRole` must be one of the keys in `roles`.
- Roles and permissions are **stable identifiers** — renaming a role requires a migration (handled automatically, see §8.4.2).

#### 8.4.2 Phase 2 — Bootstrap (framework, migration, one-time)

`@facilis/auth`'s Drizzle-kit plugin generates the schema **and** the seed from the config. On `drizzle-kit generate`:

```sql
-- Auto-generated from facilis.config.ts

CREATE TABLE roles (name text PRIMARY KEY);
CREATE TABLE role_permissions (
  role text REFERENCES roles(name),
  permission text NOT NULL,
  PRIMARY KEY (role, permission)
);
CREATE TABLE user_roles (
  user_id uuid REFERENCES users(id),
  role text REFERENCES roles(name),
  assigned_by uuid,
  assigned_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- App-scoped (D-136): sessions and user_roles have no tenant column; each policy inherits the
-- parent user's visibility, and RLS is what grants facilis_app access to the table.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_user_access ON sessions FOR ALL
  USING (exists (select 1 from users u where u.id = sessions.user_id))
  WITH CHECK (exists (select 1 from users u where u.id = sessions.user_id));
CREATE POLICY user_roles_user_access ON user_roles FOR ALL
  USING (exists (select 1 from users u where u.id = user_roles.user_id))
  WITH CHECK (exists (select 1 from users u where u.id = user_roles.user_id));
-- roles and role_permissions stay system-only: no RLS, no grant for facilis_app (D-136).

-- Seed from config.auth.roles
INSERT INTO roles (name) VALUES ('admin'), ('manager'), ('user'), ('viewer');

INSERT INTO role_permissions (role, permission) VALUES
  ('admin', '*'),
  ('manager', 'todos:read'),
  ('manager', 'todos:write'),
  ('manager', 'users:read'),
  ('user', 'todos:read'),
  ('user', 'todos:write'),
  ('viewer', 'todos:read');
```

**Key invariant:** `role_permissions` is a **projection** of `facilis.config.ts`. It is written **only** at migration time.

#### 8.4.3 Phase 3 — Assignment (admin, runtime, data)

**Bootstrap of the first admin** — via env vars: the email names the account, the token is the
credential. Both are required (D-150):

```bash
# .env (never committed)
FACILIS_INITIAL_ADMIN=founder@azienda.it
FACILIS_INITIAL_ADMIN_TOKEN=<one-time secret, e.g. openssl rand -base64 32>
```

`@facilis/auth` promotes only when ALL of these hold: `FACILIS_INITIAL_ADMIN` is set, a
non-empty `FACILIS_INITIAL_ADMIN_TOKEN` is set, the registration presents that token (constant-time
comparison over SHA-256 digests), the canonical `lower(email)` equals the configured address, and no
`admin` role exists yet. The registration route's response is generic (`{ accepted: true }`) and
never reveals whether the caller was promoted; the audit records the resulting role, never the token
or the email. A missing token fails closed, and the promotion is one-time: keeping the variable
configured after bootstrap does not allow a second promotion.

```typescript
// server/routes/api/auth/register.post.ts (blueprint, abbreviated)
const promoted = await registerInitialAdmin(systemDb, user.id, body.bootstrapToken)
```

**Subsequent assignments** — via admin UI or API:

```typescript
// server/routes/api/users/[id]/roles.post.ts
export default defineAuthorizedHandler(
  {
    permission: "users:manage",
    body: z.object({ role: z.string() }),
    params: z.object({ id: z.string().uuid() }),
    dbTables: ["user_roles"],
  },
  async (event, { body, params, auth, db }) => {
    await db.insert(userRoles).values({
      userId: params.id,
      role: body.role,
      assignedBy: auth.userId,
    })
    return { ok: true }
  },
)
```

#### 8.4.4 Runtime Flow

```
1. Session middleware reads `Authorization: Bearer <token>` first, else the session cookie
   → bearer: validateApiToken → the client's service user + the client's fixed role (`via: "bearer"`)
   → cookie: loads user from `users` → assigned roles from `user_roles` (`via: "session"`)

2. expandRoles(roles, config.auth.roles) → permission set
   (pure function, reads config — no DB query)

3. event.context.auth = { userId, roles, permissions, via }   // no tenant: it is the deployment's

4. defineAuthorizedHandler checks `permission` against perms
   → 403 if missing, before handler runs

5. policyContext.run({ tenantId: deploymentTenant, userId, roles }, ...)
   → SET LOCAL app.user_id    = '<uuid>'
   → SET LOCAL app.tenant_id  = '<uuid>'
   → SET LOCAL app.roles      = '["manager"]'
   → SET LOCAL app.permissions = '["todos:read"]'   // permission views (D-098)

6. Handler runs. RLS evaluates policies on every query.
```

**Email verification (D-156).** With `auth.verification.enabled`, a password account starts with
`email_verified_at = NULL` and the blueprint login answers `403 email_unverified` after the
password check (never before: the response must not be an existence oracle). The single-use link
`GET /api/auth/verify-email?token=…` consumes the hashed row inside the audited `system:auth`
elevation and redirects to `successRedirect?verified=1` or `failureRedirect?verify_error=invalid_token`.
Delivery is environment-owned: the project posts `{ to, subject, text }` to
`FACILIS_EMAIL_WEBHOOK_URL` (optional `FACILIS_EMAIL_WEBHOOK_TOKEN`, sent as a Bearer) or, in
`development`/`test` only, verifies immediately without a mailbox so the demo and the IDE smoke
run need no account. An unverified registration cannot start a session; an SSO login with the
verified IdP address claims it and clears the placeholder password (SEC-02). With
`auth.verification.enabled` false the claim would reset a password its owner may still use, so the
link is refused with `sso_email_conflict` instead.

The tenant in step 5 is the deployment's (`FACILIS_TENANT_ID`, or the framework constant),
never the session's: `AuthContext` carries no tenant, and a session whose user row names another
tenant is refused (D-040). The same value is the default of every tenant column, so an insert
never names it either.

**Why expand permissions from config, not from `role_permissions` table?** Because the config is the source of truth. Querying `role_permissions` on every request would (a) add a DB roundtrip, (b) create a second source of truth that could drift.

#### 8.4.5 RLS Policies with App Roles

**Only app roles.** No Postgres `CREATE ROLE` / `SET ROLE` / `TO manager_role`. All policies read `current_setting('app.roles')::jsonb`.

**One framework exception: audited sudo (D-099).** A request may need a server-side operation
that the user's permissions/RLS must not allow directly. `ctx.sudo({ operation, reason, tables },
fn)` runs `fn` inside a SAVEPOINT of the request transaction as `facilis_system` — a framework
Postgres role (`NOLOGIN NOSUPERUSER BYPASSRLS`, DML only, never assigned to users, never
referenced by a policy, reachable only through the wrapper). The audit entry is appended **before**
the role switch (fail closed): if the sink is unwritable the escalation is refused. `tables` must
be a non-empty subset of the route's `dbTables`, the call requires a session, and nesting is
rejected. Public/bootstrap routes that have no session (registration, initial admin) use the
sibling `ctx.system({ actor: "system:<job>", operation, reason, tables }, fn)`: the same audited
flow, with the system actor recorded instead of a user. Background jobs use the same audited
flow through `runAsSystem` (D-107): the job/CLI counterpart opens its own transaction instead of
joining a request, records `system:job:<name>`, and accepts `tables: []` when the definition
declares no audit tables — `ctx.sudo` and `ctx.system` keep requiring a non-empty subset. The
trail is a dedicated append-only log, never a database table, so it survives the rollback it
describes; the
default sink is one JSON line on stdout (`facilis:sudo …`), replaceable by the deploy (O-014).
Entries carry the acting user or system actor, the session hash (never the raw cookie), roles,
tenant, route/method, the route's permission, operation, reason, tables, request id and outcome.

**The request DB is bounded; escalation is explicit.** `defineAuthorizedHandler` opens the
transaction as `facilis_app` with the session GUCs (RLS is the row boundary) and hands the
handler a `FacilisHandlerEvent` that does **not** carry the root client (`context.facilis` has
only `defaultTenantId`). `ctx.db` is therefore the only default DB surface; any operation that
needs the system role must go through `ctx.sudo`/`ctx.system`. Code that tries the raw client
(`event.context.facilis.db`, or importing `createDb`) does not type-check in a handler and is
reported by the analyzer as `route-direct-db` (warning, "not recommended").

**Example — documents where admins see all, others see their own:**

```typescript
// documents.ts (your schema)
import { pgTable, pgPolicy, uuid, text, sql } from "drizzle-orm/pg-core"
import { tenantColumn } from "@facilis/db"

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  ownerId: uuid("owner_id").notNull(),
  tenantId: tenantColumn(),
}, () => [
  pgPolicy("documents_tenant_isolation", {
    as: "restrictive",
    for: "all",
    using: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
    withCheck: sql`tenant_id = current_setting('app.tenant_id')::uuid`,
  }),
  pgPolicy("documents_read", {
    for: "select",
    using: sql`
      nullif(current_setting('app.roles', true), '')::jsonb ? 'admin'
      OR owner_id = current_setting('app.user_id')::uuid
    `,
  }),
])
```

`tenantColumn()` is the tenant `uuid` column with `DEFAULT nullif(current_setting('app.tenant_id',
true), '')::uuid`: the database fills it from the same GUC the policy reads, so an insert never
names the tenant and cannot name a different one (D-040).

**Why `AS RESTRICTIVE` and `nullif`?** Postgres ORs multiple *permissive* policies for the same command, so a permissive tenant policy would not constrain the admin clause — admins would see other tenants; `packages/db/src/rls.ts` emits the form that fixes it. Tenant isolation must be `AS RESTRICTIVE` (AND-ed) so it always applies. The `nullif(..., '')` guard covers the GUC lifecycle: after `RESET app.roles` the setting is `''`, and `''::jsonb` raises `invalid input syntax for type json`. PGlite connects as a superuser and bypasses RLS even with `FORCE`, so tests must `SET ROLE` to a non-superuser (verified in Phase 0; `packages/db/src/rls.test.ts` keeps that regression).

**Result:**

| Caller | Roles | Behaviour |
|---|---|---|
| `admin` (tenant T) | `["admin"]` | Sees all documents in tenant T |
| `manager` (tenant T, owns 3 docs) | `["manager"]` | Sees only their 3 docs in tenant T |
| `user` (tenant T) | `["user"]` | Same as manager — owner-only |
| `admin` (tenant U) | `["admin"]` | Sees all documents in tenant U (not T) |

#### 8.4.6 Table access classes: RLS-scoped or system-only

Every table in the `public` schema is exactly one of two classes (D-136):

| Class | RLS | `facilis_app` | Reachable from |
|---|---|---|---|
| **App-scoped** | enabled, with its policies | `SELECT/INSERT/UPDATE/DELETE` | routes through `ctx.db`, filtered by the policies |
| **System-only** | off | no table privilege at all | the privileged owner connection and `facilis_system` (`ctx.sudo`/`ctx.system`/`runAsSystem`): boot, migrations, the dev console |

RLS is the grant boundary, not optional hardening. A table without RLS is **not** open to everyone
and **not** denied to everyone — it is unreachable for the request identity, and that is exactly
what makes it system-only.

**Enforcement.** `ensureAppRole(db)` runs after migrations (dev boot, and the deploy step in
[POSTGRES.md](./POSTGRES.md) §4) and reconciles privileges with the live catalog: it first clears
every table-class privilege (so an older cluster's blanket grant cannot survive on partition
children, materialized or foreign tables), then re-grants only the RLS tables — the catalog's
`pg_class.relrowsecurity` decides, so a table keeps DML only while RLS is enabled and every other
table is `REVOKE`d from `facilis_app` and `PUBLIC`. No table default privilege is installed, so a
table a migration creates stays closed until its RLS is on and the function runs again — the first
query fails closed with `permission denied`. Sequences remain granted (USAGE cannot read or write a
table), and the role is `NOINHERIT`: it is a member of `facilis_system` only so a deployment whose
connection already is `facilis_app` can `SET ROLE` for the audited elevation, and inheriting that
membership's grants would reopen every system-only table.

**Route declarations (D-157).** The route-level counterpart is `dbTables`: a route declares every table or
view it reaches through `ctx.db`/`ctx.sudo`/`ctx.system`, the analyzer/validator check the declaration
against the code, and the runtime guard refuses an undeclared relation before the query (fail-closed). A
system-only table is still reachable only through the audited elevation, and the elevation's own `tables`
are checked against what the callback observed.

**Framework tables.** `users`, `sessions`, `user_roles`, `auth_identities`, `auth_sso_states`,
`api_clients`, `api_tokens`, `facilis_files`, `facilis_jobs` and the generated link tables are
app-scoped. `sessions`, `user_roles`, `api_clients` and `api_tokens` have no tenant column of
their own: their policy is an `EXISTS` over `users` (the D-053 inheritance pattern), so they are
visible exactly when their parent user is — for an API client, its `users.is_service` service
account (D-142). `roles` and
`role_permissions` are system-only: migrations seed them, and permissions reach the runtime from
`facilis.config.ts` through `expandRoles`, never from the table.

**Graph, analyzer and drift.** The project graph labels a table without RLS **system-only**, in a
neutral colour — it is a class, not a warning — and the Data Explorer's live badge uses the same
label. The analyzer warns `route-system-table` when a route declares a system-only table in
`dbTables` (or as the table side of `dbColumns`) outside the elevation whose `tables` name it
(D-137). The drift `rls_disabled` is reported only for a scoped table (a system-only table is a
classification, not a defect).

### 8.5 Dev-Endpoint Guards

| Endpoint | Guard |
|---|---|
| `/__facilis/manifest` | 404 in prod, origin allowlist |
| `/__facilis/dev/schema` | 404 in prod |
| `/__facilis/dev/query` | 404 in prod, read-only SQL prefix check |
| `/__facilis/dev/view` | 404 in prod, view name/read-only validation, view permission must exist in `facilis.config.ts` |
| `/__facilis/health` | 404 in prod |

### 8.6 Application-Level Security Rules

- A GET route is side-effect free: `SameSite=Lax` sends the session cookie on a cross-site
top-level GET navigation, so a state-changing GET is CSRF-able even with the origin gate (which
covers unsafe methods only). The framework-owned SSO GET/ACS pair is the single, protocol-driven
write path; an application route must not add another one (D-141).
- CSRF is structural, not a per-route courtesy (D-141): `defineAuthorizedHandler` rejects an
  unsafe cross-site request (403) before the permission check, and a JSON/form route answers
  `415 unsupported_media_type` for any other media type — so `SameSite=Lax` is defense in depth,
  not the only barrier. `crossSite: true` is an exposure declaration for public routes, never a
  CSRF defense; login/logout/register are covered because they write cookies.
- API service accounts cannot log in (D-142): `users.is_service` marks them, `createSession`
  throws and `validateSession` refuses one, SSO never links/provisions one and the template login
  route rejects it. The framework-owned `POST /api/auth/token` is their only credential path
  (client id + secret → short-lived Bearer, no refresh token); it answers 404 when
  `auth.apiClients.enabled` is false, 401 generically for a wrong/revoked client, and audits
  issuance/failures without the secret or the token. Issuance is rate-limited per client id
  (D-143): over the `auth.apiClients.rateLimit` budget the route answers `429 too_many_requests`
  with `retry-after` before touching the database. The window is in-process, so it resets on
  restart and is not shared across instances; revocation stays per client (the client and every
  token it issued), never per single token.
- AI patches are **validated** before write (18 rules, §9.3)
- AI never receives PATs or secrets
- Superuser query results are **never** persisted or sent to LLM
- Query console is read-only by construction
- Sudo is the only way to run application SQL as `facilis_system`; every call is audited before
  the role switch and fails closed when the audit sink is unavailable (D-099). The system role is
  a framework exception to §8.4.5, not an app role
- The handler-visible event carries no raw database client: `ctx.db` is policy-scoped and
  escalation is only `ctx.sudo`/`ctx.system`. The analyzer warns `route-direct-db` when route
  code reaches for the raw client (`facilis.db`, `createDb`), so direct policy-free DB access is
  visibly not a recommended practice
- A permission view is definer and bypasses the base tables' RLS: its SQL and its declared
  permission are the whole surface, and the permission gate is defense-in-depth (a custom GUC is
  settable by any role), not a boundary against deliberately hostile code (D-098)
- `role_permissions` is written **only** at migration time
- Logging is structural, not a per-route courtesy (D-119): `defineAuthorizedHandler` writes
  exactly one access entry per request, unexpected failures are recorded server-side and never
  returned to the client, and the sudo trail joins the same append-only sink. Logs are JSON
  Lines files in `<project>/.facilis/logs/` (dev) or stdout (production); **no HTTP endpoint
  serves them**, not even a dev-only one
- An audit entry is never filtered by the diagnostic level and audit writes fail closed: if the
  sink is not writable, sudo refuses to escalate (D-099). Access/error/app writes are
  best-effort and cannot fail a response
- Single sign-on is framework auth (D-120): providers are declared in `facilis.config.ts` with
  secrets named by env var only; an unverified email never links to or provisions an account;
  `auth_identities` and `auth_sso_states` are written only inside the audited `ctx.system`
  elevation; the routes live under the framework-owned `/api/auth/sso/**` namespace

### 8.7 Logging & Audit Trail

**Four streams, one pipeline (D-119).**

| Kind | Produced by | Fields (non-exhaustive) |
|---|---|---|
| `access` | `defineAuthorizedHandler`, every exit path | `requestId`, `method`, `path` (pathname only), `status`, `durationMs`, `userId`, `sessionHash`, `tenantId`, optional `ip`/`userAgent` |
| `error` | the wrapper on an unexpected failure | `requestId`, `code`, `name`, `message`, `stack`, `method`, `path` |
| `audit` | sudo/system (D-099), SSO (D-120) and `ctx.log.audit` | `event`, `actor`, `operation`, `outcome`, `errorCode`, `durationMs`, `reason`, `tables`, `roles`, `details` |
| `app` | `ctx.log.debug/info/warn/error` | `message`, `data` (redacted), `requestId` |

**Destination is a deployment concern.** `FACILIS_LOG_SINK` = `auto|stdout|file|both`;
`auto` (default) writes `.facilis/logs/{access,audit,error,app}.jsonl` when
`NODE_ENV` is `development`/`test` and stdout otherwise (D-146). `FACILIS_LOG_DIR` overrides the
directory, `FACILIS_LOG_MAX_BYTES` (10 MiB) / `FACILIS_LOG_KEEP` (5) bound rotation, and
`FACILIS_LOG_LEVEL` overrides `logging.level` from the config. A project cannot redirect the
operator's trail: sinks are env-owned like the database target.

**No HTTP surface.** There is deliberately no log endpoint (not even `/__facilis/dev/logs`):
the files carry request paths, user ids, session hashes, client IPs and stack traces, and the dev
origin allowlist is not a boundary inside the browser VM. The IDE's Logs view reads the files
through the kernel VFS and opens them in the editor (D-119); operators use any text tool.

**Redaction and caps.** Keys matching token/secret/password/cookie/authorization/set-cookie/
api-key/credential/SAML payload/assertion/email/session-id (case-insensitive) are redacted in
`data`/`details`; depth 6, arrays 50, strings 1000 characters, cycles marked. Headers and
request/response bodies are never logged.

**Rotation and tamper evidence.** Before an append would pass the byte cap the active file is
shifted to `.1`, `.2` … and the oldest is dropped after `FACILIS_LOG_KEEP` files. File-written
audit entries carry `seq`, `prevHash` and `hash` (SHA-256 over a stable canonical JSON of
the entry without the hash fields); `verifyAuditChain` verifies a readback. The chain is
tamper-evident within a file, not tamper-proof (no secret key); WORM, HMAC and external sinks
belong to the deploy (O-019). Development log files live under `.facilis/`, which is already
gitignored.

**Audit is fail-closed; the rest is best-effort.** A broken audit destination throws and the
elevation is refused (D-099). A broken access/error/app destination is contained (a one-time
`console.error` fallback) and never fails a request.

**Verification.** The core suite pins the access entry on 401/403/400/503/success/throw and the
server-only error entry; `@facilis/nitro`'s logging suite pins env resolution, stream routing,
redaction/caps, level filtering, rotation, chain verification (good/tampered), fail-closed audit,
the request-id middleware and the bootstrap/sudo bridge; the IDE suite pins the log parser and
filters. `docs/LOGS.md` is the operator contract.

---

## 9. AI Orchestration

### 9.1 Model A (MVP) vs Model B (Target)

| Aspect | Model A | Model B |
|---|---|---|
| Context delivery | Full manifest preloaded | Summary preloaded + tools |
| LLM calls per turn | 1 | 1 + N tool calls |
| Tokens for "add field" | ~4–6k | ~8–12k |
| Wall time | 10–20s | 30–60s |
| Accuracy | Good for small tasks | Good for any task |

**Status (2026-11-07): the chat always uses the tool-backed mode** (D-101/D-103); the table is
the design history. Model A's context assembly (file list, config, manifest, AGENTS.md) remains
as context, not as a separate chat mode, and Model B's per-call tool list was superseded by PTC
(§9.5).

### 9.2 System Prompt (Shared Core)

Rules the AI must obey:

1. Every route uses `defineAuthorizedHandler`
2. `dbTables` and `permission` required
3. Zod schemas for any used input
4. All scoped tables get RLS policies in the same patch
5. Use existing blocks; do not create new ones unprompted
6. All strings via `t("key")`
7. Minimal patches; match existing style
8. Output is a single `AIResponse` JSON object; no prose outside. A set too large for one answer is sent in parts with `"continue": true` (D-106; no part quota, D-108)
9. **Do not invent permissions or roles.** If a route needs a permission not declared in `facilis.config.ts`, add it to `config.auth.permissions` in the same patch and note it in `notes`. Same for new roles.
10. **Every route carries a description:** one English sentence, max 120 characters (about two lines), saying what the route does and what it touches; keep it current when the route's contract (permission, inputs, `dbTables`/`dbColumns`) changes. It is source documentation shown in the graph and OpenAPI, never a `t()` key (D-129).

### 9.3 Patch Validator (18 Rules)

| # | Rule | Severity | Checks |
|---|---|---|---|
| 1 | `ts-parse` | error | TypeScript parses (syntactic diagnostics; type errors belong to the editor's language service) |
| 2 | `route-security` | error | Every route uses `defineAuthorizedHandler` |
| 3 | `db-tables-present` | error | `dbTables` field present (empty OK) |
| 4 | `db-tables-valid` | error | All `dbTables` exist in schema (or this patch) |
| 5 | `db-columns-valid` | warning | All `dbColumns` format and exist |
| 6 | `permission-valid` | error | Every `permission` exists in `config.auth.permissions` |
| 7 | `block-import-valid` | error | Every block import matches a `BlockManifest` |
| 8 | `route-input-validated` | error | Handler uses `body.x` → Zod schema required |
| 9 | `no-raw-db-access` | error | No raw Drizzle client imports outside `@facilis/db` |
| 10 | `rls-on-scoped-table` | error | Every scoped table in the resulting `db/schema.ts` ships with `enableRLS` + a policy helper |
| 11 | `file-path-allowed` | error | Files only in `server/`, `src/`, `db/`, `lib/`, `components/`, `locales/`, plus `facilis.config.ts` (`AGENTS.md` only through the IDE writer's explicit `rootFiles`) |
| 12 | `import-resolves` | error | All imports resolve (relative or in `node_modules`) |
| 13 | `i18n-keys-registered` | warning | All `t("key")` calls have keys in `locales/en.json` |
| 14 | `migration-generated` | warning | Schema changes ship with a migration file |
| 15 | `destructive-confirmed` | error | Destructive schema → `requires_confirmation: true` |
| 16 | `role-config-sync` | error | If patch modifies `facilis.config.ts` roles/permissions, a new migration file must update seeds |
| 17 | `route-description` | warning | Every patched, valid route has a one-sentence English `description` (≤120 chars ≈ two lines), refreshed when its contract (permissions, inputs, `dbTables`/`dbColumns`) changed |
| 18 | `route-table-declared` | error | Every relation used through `ctx.db`/`ctx.sudo`/`ctx.system` (following project-local helper calls) is declared in `dbTables` — tables and views; a dynamic/unresolvable relation and `db.execute` without `rawSql: true` are errors; a declared-but-unused relation is a warning (D-157) |

**Status (2026-11-04): implemented over AST facts** in `@facilis/ai` (D-084, D-092/D-093).
The main entry stays browser-safe: `validatePatch(patches, { context, requiresConfirmation,
allowedRootFiles })` is synchronous and takes a typed `PatchContext` whose facts are the
effective (post-patch) `Analysis` from `@facilis/analyze` plus the pre-patch one for inverse
edits. The caller supplies them — the IDE analyzes the VFS snapshot and the patch overlay with
its one warm browser worker, caching the pre-patch analysis; Node tooling uses the
`@facilis/ai/node` helper. Sources are read only for `package.json` (installed packages) and
`tsconfig.json` (path aliases); the manifest's `blocks` section is reserved and always empty now
that no block package ships (D-131). Rule 1 parses through an injected `SyntaxChecker` — the analyzer worker's oxc
parser in the IDE (D-105), the `@facilis/ai/node` subpath (rolldown/oxc) outside it — and fails
closed when no checker answers. If the analyzer itself is unavailable the IDE fails the round
closed with a `project-analysis` error and never applies the patch. A parser/analyzer outage is
an `infrastructure` finding: the chat reports a validator outage and does not spend a repair
round asking the model to fix it (D-105). Rules 5, 13, 14 and 17 are warnings; the rest
block the apply. The IDE validates at proposal time, re-validates the accepted files at Apply
time and `applyPatch()` re-validates before the first VFS write. Facts are AST-derived now:
wrapper/body-read/`dbTables` cannot be spoofed by comments or strings, `dbColumns` uses Drizzle
property names, imports cover static/re-export/dynamic/`require` and rules 10/14/15 ignore
framework re-exported tables. Declared limits: i18n covers static `t()` keys and the effective
default catalogue, migration detection is the presence of a `.sql` file, destructive detection
covers tables/columns. A rejected round does not surface as a one-shot error: its
findings feed the §9.4 repair loop.

### 9.4 Retry Loop

```
Turn 1 → AI responds → validate → (errors) → correct → validate → … until the validator passes
```

**Status (2026-11-07): implemented** in the IDE chat (D-100, hardened by D-102).

- **No attempt cap (D-108).** A rejected answer is corrected until the validator passes. The loop
  ends only on a passing set, a provider/transport failure, the user's Stop, or a validator outage
  (D-105). There is no model-call, exploration, part or correction counter.
- **Any rejected answer starts a repair**, not only a validator error: unparseable JSON, an
  `AIResponse` contract violation or a rule violation all re-ask the model.
- **The repair request is one user-role turn** carrying a **fix plan grouped by file, root cause
  first** (schema/config before the route findings they usually cause), the files the rejected
  answer touched, a numbered findings list with `rule`, `file`, `message`, `fix_hint` and
  `line`/`excerpt`, and a reminder of the `AIResponse` contract. Validation stays **set-level**
  on purpose: the rules are cross-patch (a route may reference a table added in the same set, a
  permission may be added in the same set), so per-file validation would report false errors;
  the feedback is per-file instead, and the `validate` tool lets the model check candidate
  subsets while iterating (D-102).
- **The repair request never inlines file content.** The chat has one mode (D-103): the
  correction tells the model to `read_file` every file it will re-emit and to `validate` the
  exact set it will return, so a `create`/`update` whole-file rewrite is repaired from the
  tools, not from prompt-stuffed content (D-101/D-102).
- **The loop lives in the IDE**, not in `@facilis/ai` (D-100): the validator stays a pure
  synchronous function, and `ide/src/ai/turn.ts` + `ide/src/ai/repair.ts` own the retries,
  the repair messages and the provider calls. `state.repair = { attempt }` exposes the progress
  to the UI (a number, not a budget).
- **Validator outages are not repairs.** A finding marked `infrastructure` — rule 1's parser or
  the analyzer unavailable — ends the turn as a validator outage: the chat says the validator is
  temporarily unavailable and nothing is written; no correction round is spent asking the model
  to fix a worker (D-105).
- **Large patch sets arrive in parts (D-106).** A provider cuts an answer at its output limit
  (Anthropic `stop_reason: "max_tokens"`, OpenAI `finish_reason: "length"`). The model sends as
  many complete files as fit in one answer (usually 2–4), marks every part but the last with
  `"continue": true`, and the turn loop merges the parts by path (a later part may correct a
  file), ORs the destructive flag, keeps the notes and validates the merged set once (the rules
  are cross-file). There is **no part quota** (D-108): the chat shows "sending the patch set in
  parts (n)" and keeps asking until a last part arrives. A correction keeps the rejected set and
  re-emits only the files it changes (`delete` drops one), so fixing two files of a three-part set
  is one answer. If the provider cut the answer anyway, the client marks it `truncated` and the
  IDE salvages the complete patch objects before the cut (`ide/src/ai/salvage.ts`), then asks for
  the rest instead of reporting a raw JSON error. Only an answer with no recoverable patch goes
  through the ordinary repair, whose report now carries the cut-off explanation and the part
  protocol.
- **The chat shows what the model is doing (D-110).** Every model call has one activity row,
  inserted when the call starts (its visible reasoning streams inside it) and completed in place
  with duration, characters and outcome (program request, patch part, final answer, rejection,
  cut), next to the exploration programs in strict chronological order. Reasoning comes from the
  provider's own field (DeepSeek `reasoning_content`, Anthropic thinking) and is display-only:
  it is never replayed to the model.
- **On failure** (provider/transport error, the user's Stop, or a validator outage): the failure is
  shown in the chat and **nothing is written** to OPFS. A rejected answer is not a failure: it is
  corrected until it validates (D-108).

### 9.5 Model B Tool Surface (Phase 4.5)

| Tool | Returns |
|---|---|
| `get_manifest()` | Full `FacilisManifest` |
| `get_schema(table?)` | `TableSnapshot` or `TableSnapshot[]` |
| `get_routes(prefix?)` | `RouteMeta[]` |
| `read_file(path)` | string |
| `list_files(dir)` | string[] |
| `search(query)` | `{ path, line, snippet }[]` |
| `get_diff(ref?)` | unified diff |
| `get_release_preview(from, to)` | `ReleasePreview` |

**Status (2026-11-02): not implemented as a tool, but its engine exists** — `buildReleasePreview`
in `@facilis/core` (D-086) is exactly the function the tool would call.

**Status (2026-11-07): a PTC design supersedes the per-call tool list above.** The model writes
one JavaScript program per step; the IDE executes it in an opaque-origin sandbox against a
tool registry whose `source` access is read-only (VFS reads, analyzer facts, manifest; MCP
servers and skill-scoped capabilities are the extension seam — the graph and git families write
only non-source state) and returns lossless JSON. Patches are still the only source write path,
validated by §9.3. Design and phases: [`PTC.md`](./PTC.md) — accepted as D-101; the
phase-0 sandbox spike passed (`spikes/ptc-sandbox`, 21/21), the phase-1 chain and trace UI
landed, and the runtime is the chat's only mode (D-103); the eval corpus and the browser matrix
remain. D-111 adds the running-app preview tools (`preview_state`/`console`/`network`/`dom`/
`click`/`fill`/`open`/`wait`/`screenshot`): the page's chobitsu CDP backend is the transport;
they observe or reproduce runtime failures but never write the project. A screenshot is shown in
the activity row and sent to the model only for a `vision` preset (D-112); the user's own
screenshot pasted into the composer with Ctrl+V follows the same wire path (D-113). D-126 added
the project-graph family (`graph_state`/`graph_arrange`): the graph is diagram state, so it is
written directly and is not source. D-139 adds the git family (`git_status`/`diff`/`log`/
`branches`/`remote`/`stage`/`unstage`/`commit`/`branch`/`sync`/`pull_request`):
repository index/history/ref/remote operations through Source Control's own sessions, never source
edits, with the tab-memory GitHub token as the only credential, dirty-tree refusals for switch/pull
and no destructive operation. D-138 makes the transcript itself chronological: a turn's activity is
persisted on its user message (success, failure or cancel) and rendered between the question and
the answer, so the executions precede the prose in every state.

---

## 10. IDE (fork of Vivari Studio)

Folder: `ide/`. Starts as the full upstream `packages/studio` at the pinned Vivari tag, then
follows this repository's toolchain (D-019). The kernel it runs on is the `vendor/vivari`
submodule of our Vivari fork, pinned to `facilis/main` — upstream tag plus the fixes this repo
depends on (D-018, D-030).

### 10.1 What We Inherit

- `IdeController` (imperative core)
- `KernelBridge` (VFS access via `@vivari/core`)
- `ScmSession` (isomorphic-git on VFS)
- COOP/COEP headers in `vite.config.ts`
- VS Code chrome (Explorer, Editor, Terminal, Preview, StatusBar, CommandPalette)
- Multi-root workspace support (foundation for multi-project) — capped at one project per tab: opening another root replaces the current one (D-033, D-035)

### 10.2 What We Add

| Feature | Location | Approach |
|---|---|---|
| AI Chat | `ChatPanel.tsx` + new activity | Calls `controller.applyPatch()` |
| Project graph | `ProjectGraphPanel.tsx` + `project-graph` editor tab | One graph from `@facilis/analyze` (D-092): pages → routes → tables plus FK/`relations()` edges; route cards carry the wrapper config's one-sentence description (D-129); fullscreen, edge filters, drag; committable, merge-friendly layout + markdown notes in `.facilis/graph/` (D-126) |
| Commit graph | `CommitGraphPanel.tsx` + `commit-graph` editor tab | React Flow over the local git log: lanes, merge edges, branch/HEAD cards, details inspector (D-088) |
| Diff tab | `EditorPanes.tsx` + `diff-session.ts` | Every SCM change opens a side-by-side HEAD ↔ working-tree diff, first hunk revealed (D-089) |
| Entity Explorer | `DataExplorerPanel.tsx` + activity view + `data-query` tab | Live code ↔ DB diff and a read-only SQL console with Create-view (optional declared view permission, D-098), through a kernel-mediated same-origin dev proxy (D-097); declared tables from `@facilis/analyze` still planned (O-011) |
| Release Preview | `ReleasePreviewPanel.tsx` + activity view | `buildReleasePreview(from, to)` (D-086) |
| Project Switcher | Extend `Home.tsx` | Uses `ProjectRegistry` + git auth |
| GitHub sign-in | Git dialogs + `GitHubSignIn.tsx` | OAuth device flow, token in tab memory (D-082) |
| Stored credentials | Extend git modal | WebCrypto storage in OPFS (planned, other hosts) |
| `applyPatch()` | `IdeController` method | Writes through `kernel.writeFiles` |

**Status (2026-10-31):** the AI chat is implemented — BYO-key providers (OpenAI-compatible and
Anthropic protocols), Model A context, a streamed `message` field with a per-file diff/accept
proposal, non-blocking browser-boundary warnings, an undo for a clean Apply, project instructions
from a root `AGENTS.md`, and `applyPatch()` as the only write path (D-045…D-048). The write path lives in
`ide/src/facilis/apply-patch.ts` rather than on `IdeController`, because the controller is
pinned by the file-length ratchet (D-019); the activity view is `chat`.

**Status (2026-11-02): the full 18-rule validator is implemented** (D-084): `parseTurn()`
validates a proposal against the live project before it is shown, the accepted files are
re-validated with a fresh context on Apply, and `applyPatch()` re-validates before the first
VFS write. Rule 1 uses the analyzer worker's oxc parser (D-105); the remaining rules read the
config, schema, catalogs, blocks and routes. Validator warnings are carried in the proposal
state but not yet rendered in the card (follow-up). The §9.4 repair loop is implemented
(D-100/D-102, no attempt cap since D-108): a rejected answer is re-asked until the validator
passes, with a root-cause-first fix plan and the findings (the model reads files with the PTC
tools; nothing is inlined); a provider error, the user's Stop or a validator outage ends the turn
and nothing is written. A parser/analyzer outage is reported as a validator
outage instead of a model repair (D-105). The PTC tool runtime from §9.5 is the chat's only mode
(D-103); the eval corpus and browser matrix remain.

**Status (2026-11-10): the graph shows every real page, page navigation and audited elevation (D-134).** Page nodes are `src/pages/**` files (including pages with no API calls and unrouted pages), with URL paths from the explicit route table; components/lib files are no longer page nodes. `page-link` edges follow explicit `Link`/`NavLink`/`navigate` targets, and a route→table edge reached through `ctx.sudo`/`ctx.system` is marked with one warning colour plus a route-card chip. Selecting a page opens a bounded static structure inspector (nested components/sections, `Outlet` composition, dynamic branches marked), not a rendering.

**Status (2026-11-09): the project graph shows framework tables (D-130).** The browser analyzer now receives the `@facilis/auth`/`@facilis/db` source it needs to resolve the tables `db/schema.ts` re-exports, inlined at IDE build time. The starter graph carries 11 tables and 46 edges (was 2/21), including the route→`facilis_files` and `todo_files→facilis_files` edges, and framework tables carry a `framework`/`sistema` badge.

**Status (2026-11-06): the project graph replaced the API Flow.** D-092's `project-graph` editor
tab is the single pages → routes → tables visualizer (plus FK/relations edges), built from
`@facilis/analyze` facts with no booted app; D-095 deleted the OpenAPI-driven API Flow panel and
its `api-flow` tab. The Entity Explorer (D-083) and the Release Preview (D-086) remain sidebar
activity views. The Release Preview now reads each ref's schema through the analyzer (D-094).
The Entity Explorer now reaches the dev server through the same kernel-mediated same-origin
proxy as the query console (D-097), so a popped-out preview works; it still needs a live
project, and O-011 tracks the declared-from-AST half and preview mode C. The query console
(`data-query` tab) runs one read-only statement and creates a `security_invoker` view in
`db/views/`. Browser smoke covers the project graph, the Release Preview and the query
console.

**Status (2026-11-08): the project graph is interaction-first (D-125).** Nodes follow the pointer
while dragging and commit on drop; edges are floating (an endpoint is the node-border/centre-line
intersection recomputed from measured bounds, so an edge attaches at any side and self-references
loop) and their cubic curve is editable per edge through a midpoint handle, persisted as
one bend file per edge under `.facilis/graph/bends/` (schema v3 since D-126; v1/v2 files migrate). Route cards show the
analyzer's request-input presence flags (body/form/query/params) and the path parameters, so the
graph is the API-contract view too. Layout and curves became committed team state in D-126.

**Status (2026-11-08): graph state is committable and merge-friendly (D-126).** The layout,
manual bends, collapse/filter settings and markdown notes are stored as small files under
`.facilis/graph/` — a settings file, one small JSON file per position or bend and one
markdown file per note — and `.facilis/.gitignore` carries a narrow allowlist so git sees them
while the rest of `.facilis` stays local; pan/zoom stays local in `viewport.json`. Because an
element is one file, independent edits merge automatically even when the elements are adjacent,
and only the same element conflicts. A pre-D-126 `.facilis/graph.json` is read once and
rewritten. Notes are
markdown annotations on the canvas (add/edit/delete, markdown rendered, double-click to edit).
The chat's PTC runtime gained `graph_state` and `graph_arrange`, so the assistant can read the
graph and arrange it on request (validated, capped, same files, no source patch), and the open
panel reloads through a graph-change event. Dragging or box-selecting no longer selects card
text.

**Status (2026-11-04): the project graph runs on static AST facts (D-092).** The `project-graph`
editor tab reads `@facilis/analyze` from a lazy wasm worker over the VFS: pages → routes →
tables plus FK and `relations()` edges, fullscreen, edge filters, drag and a gitignored
`.facilis/graph.json` layout. No manifest/OpenAPI endpoint is needed for the graph; the browser
smoke covers it.

**Status (2026-11-10): a git worktree change reloads the editor (D-140).** Checkout, discard and
remote pull share one refresh path: the SCM change list and Explorer update, open text buffers
reload from disk, and a buffer with unsaved edits is kept and reported instead of being
overwritten (the pulled branch is the repository, the unsaved bytes are the user's).

**Status (2026-11-02): Source Control shows history.** The SCM panel's rows open a real diff for every change — untracked and deleted files included, side by side and scrolled to the first hunk (D-089) — and each repository can open a commit graph in the editor area: branches, merges and the current HEAD drawn with React Flow over the local git log, read on demand and never over the network (D-088). The graph is local-only, so it behaves the same in an open and a managed deployment.

### 10.3 VFS Write Rule

**Never write to OPFS directly.** All writes go through:

```typescript
await this.kernel.writeFiles(patch.map(f => ({
  path: `/home/user/project/${f.path}`,
  content: f.content,
})))
```

This triggers HMR (client) and worker reload (server), updates the revision hash, and mirrors to OPFS automatically.

### 10.4 isomorphic-git on VFS

```typescript
await git.commit({
  fs: vivari.fs,                      // VFS, not OPFS
  dir: "/home/user/project",
  message: "feat: add dueDate to todos",
})
```

### 10.5 Multi-Project Switch

1. Detect `uncommittedFiles > 0` → prompt commit/stash/discard
2. `controller.closeProject()` — flush VFS to OPFS
3. `controller.openProject(newRef)` — boot Vivari at new OPFS path
4. Global state (LLM key, theme) survives; per-project state is per-project

**One project per tab (D-035).** A tab holds exactly one workspace folder: `openFolder()`
closes the tab's other roots first, so the editor tabs/models/index, the `?project=` boot
parameter, the browser title, the project Web Lock, the run phase and the Explorer all describe
that one project; a second project means a new tab ("Open in a new tab"), not a second root.
The label is derived, never stored: `projectName(rootPath)` (the last path segment) is the only
source for the Explorer root, the title bar, the browser title and Home's recent rows. The
recent-projects registry stores `ProjectMeta = { rootPath, template, createdAt, lastModified }`
— there is no `name` field, and a legacy entry's `name` is ignored on read.

### 10.6 Runtime Model Inside Vivari

This is the corrected mental model after confirming Nitro v3's Vite-plugin architecture.

**There is one dev process, not two.**

When the starter project boots inside Vivari, the user runs **`vite dev`** — not `nitro dev`, not two parallel commands. Vite is the entry point. Nitro is mounted as a plugin inside it.

```
┌───────────────────────────────────────────────┐
│  Vivari Kernel (inside the browser tab)       │
│                                               │
│  ┌─────────────────────────────────────────┐  │
│  │  Vite dev server (single process)       │  │
│  │  ├── React plugin → client HMR          │  │
│  │  └── Nitro (mounted by facilis()):      │  │
│  │      ├── server routes (/api/*)         │  │
│  │      ├── OpenAPI generation             │  │
│  │      ├── /__facilis/* endpoints         │  │
│  │      └── server code in isolated worker │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  PGlite (separate WASM instance)              │
└───────────────────────────────────────────────┘
```

**Consequences for the Studio:**

| Aspect | Behaviour |
|---|---|
| **Preview target** | One origin, one port. The preview iframe points at the Vite dev server, which serves both React and `/api/*`. No need to reverse-proxy two ports. |
| **HMR on client edits** | Vite HMR fires normally. |
| **Server reload on route edits** | Nitro's worker reloads automatically when files under `server/` change. No manual restart. |
| **`/__facilis/manifest` reachability** | Served by Nitro inside Vite, on the same origin as the preview. Studio fetches it directly from the preview iframe's origin. |
| **`/_openapi.json` reachability** | Same — Nitro plugin exposes it on the Vite origin. |
| **PGlite lifecycle** | PGlite is imported by server routes. It boots when the Nitro worker initializes. The Studio does not manage it directly. |
| **Restart after crash** | If the Vite process dies, the Studio restarts `vite dev` through Vivari. There is no separate Nitro process to restart. |

**Why this matters for the spec:** earlier drafts described "Vivari boots Nitro + Vite" as if they were two servers. They are not. The correct phrasing is **"Vivari runs `vite dev`, and Nitro runs as a plugin inside Vite."** All references in this spec have been updated accordingly.

**What the starter's `package.json` must declare:**

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

**What the Studio's `IdeController` must run:**

```typescript
// Simplified
await vivari.spawn("npm", ["run", "dev"])    // runs `vite dev`
// Wait for the port to be ready
await waitForPort(vivari, 5173)
// Then point the preview iframe at http://localhost:5173
```

**Note from Nitro docs:** *"When using the Vite plugin, prefer `vite dev` over `nitro dev`; the Nitro CLI dev server does not support the Vite builder."* This is why the starter's `dev` script must be `vite dev`.

---

## 11. Data & Release Tooling

### 11.1 Entity Explorer (Phase 3)

- Reads from both `db/schema.ts` (via `getTableConfig`) and the live catalog (`pg_catalog`: `format_type`, `pg_get_expr`, `relrowsecurity`, `pg_policies`)
- **Diffs them** through a pure function: typed drift like *"code says X, DB says Y — run the project's migrations"*
- RLS status badges: 🟢 policy defined / 🟡 RLS on, no policy / 🔴 RLS off on scoped table / ⚪ system-only (RLS off, unscoped)
- Reverse lookup: "used by these routes" (from `x-db-tables`/`x-db-columns`)
- Click to jump to `db/schema.ts` or the route file in Monaco

**Status (2026-11-06): implemented, kernel-mediated connection** (D-083, D-097, O-011).
`@facilis/db` exposes `liveSchemaSnapshot` and `diffSchemaSnapshots`; `GET /__facilis/dev/schema`
is the dev-only transport (404 in production, origin-allowlisted) and the Studio renders it in
the `data` activity view, next to the query console (§11.2). The panel builds every request from
a same-origin `/preview/<port>/…` URL carrying the kernel token, which the Studio's Service
Worker routes to the in-VM dev server; a popped-out preview therefore works, and no embedded
iframe is required. The SW persists its per-frame routing in the `vv-config` cache (D-132), so a
preview reload after an idle worker eviction still reaches the tab that served it. Remaining: the
declared half can come from `@facilis/analyze` immediately (a project that is not running), and
preview mode C (wildcard origins, no same-origin SW) needs its own transport. O-011 tracks both.

### 11.2 Query Console + Declarative Views (implemented, D-097/D-098)

The Data Explorer's central pane is a SQL console (`data-query` editor tab); the table list stays
in the `data` activity view on the left.

- **Transport**: `POST /__facilis/dev/query`, through Nitro in the kernel, never SPA → PGlite
  directly. The same-origin dev proxy keeps it working when the app preview is popped out.
- **Read-only by construction**: one statement (SELECT/WITH/VALUES/TABLE), a `READ ONLY`
  transaction, a 5 s statement timeout and an outer LIMIT with a `truncated` flag. A write is
  rejected by the prefix check; a writing function reached from a SELECT is rejected by the
  transaction.
- **Developer mode**: the console runs as the connecting superuser, so RLS is bypassed in the
  preview (SPEC's "superuser (with warning)" mode) and the UI says so. A per-user/role RLS mode
  remains open (O-012).
- **Create view**: the button validates the SQL, creates (or replaces) the view live, and
  stores one file per view in `db/views/<name>.ts`:
  `defineView({ name, columns, query, permission? })` from `@facilis/db` (§5.2), written through
  the VFS so a generated project keeps it. An optional permission is chosen from the config's
  declared permissions (the endpoint answers `invalid_permission` otherwise) and the file keeps
  the choice; with a permission the dialog says the underlying RLS does not apply. One file per
  view means no import/barrel merge, and the array module `#facilis/db-views` collects them.
- **Two permission modes (D-098).** Without `permission` the view keeps D-097's behaviour:
  `security_invoker = true`, it runs as the policy-scoped `facilis_app` a route already runs as,
  and the base tables' RLS/grants are its permissions. With `permission` it is a **definer** view
  (`security_invoker = false`): only the declared permission gates the rows
  (`app.permissions ? '<permission>'`), and the base tables are not consulted. The second mode is
  for table-like resources (statistics, projections) where the developer owns what the SQL
  exposes; the permission gate survives a route that forgot its `permission` but is not a
  boundary against deliberately hostile code (custom GUCs are settable). A plain view would
  bypass RLS — `@facilis/db` proves both the leak and the invoker guarantee.
- **Route declaration (D-157).** A route that reads a view declares the view's **name** in `dbTables`, not its
  base tables: the view is the relation the handler touches, and for a definer view the declared `permission`
  (not the base RLS) is the gate. `@facilis/analyze` parses `defineView` into `ViewFact`s (name, base tables,
  permission, access), so the validator accepts the view name and the usage pass resolves it; the runtime
  guard compares the Drizzle view object's name with the declaration. Base tables stay in the view's own
  metadata, never in the route declaration.
- **Provisioning**: dev boot re-applies `db/views/**` after migrations (a broken view becomes a
  manifest warning, never a failed boot). A Postgres deployment provisions views in its deploy
  step like migrations, and boot reports `view_ddl_skipped`.
- Results are never persisted and never enter LLM prompts.

### 11.3 Release Preview (Phase 3.5)

Four diff lenses, one engine:

| Lens | Compares | Answers |
|---|---|---|
| Code ↔ Live DB | `db/schema.ts` vs live catalog | In sync? (engine: `diffSchemaSnapshots`, D-083) |
| Working copy ↔ HEAD | OPFS vs last commit | What am I about to commit? |
| HEAD ↔ origin/main | Local vs remote | What ships on next deploy? |
| origin/main ↔ Tag | Remote vs release ref | What changed since last release? |

**Risk classification per statement:**

- 🟢 Safe: add nullable column, add table, add index, add policy
- 🟡 Careful: non-null without default, add UNIQUE, rename
- 🟠 Destructive: drop column/table, narrow type, tighten RLS
- 🔴 Breaking: drops referenced by routes (cross-checked with `x-db-columns`)

**Status (2026-11-05): implemented** (D-086, D-094). The pure engine `buildReleasePreview` lives
in `@facilis/core` (browser-safe) and classifies the migration statements that ship between two
refs; the Studio reads `db/**`, `facilis.config.ts`, `server/routes/**` and the migrations out of
the VFS at `HEAD`/`origin/main`/tag with isomorphic-git instead of booting the old ref (O-008
resolved), and shows three git lenses plus the code↔live card from D-083. The declared schema is
`@facilis/analyze` facts over those ref sources (columns as Drizzle property names, policies and
RLS flags from the DSL), so column types/renames still surface only through migration SQL and a
route derived at an old ref knows method+path only.

### 11.4 Dev-Only Endpoints

| Endpoint | Purpose | Guard |
|---|---|---|
| `GET /__facilis/dev/schema` | Code↔live schema + drift (§11.1, D-083) | 404 in prod, origin allowlist |
| `POST /__facilis/dev/query` | Read-only SQL console (§11.2, D-097) | 404 in prod, origin allowlist, read-only transaction + timeout + LIMIT |
| `POST /__facilis/dev/view` | Create/replace a view, optional declared permission (§11.2, D-097/D-098) | 404 in prod, origin allowlist, view-definition validation, `invalid_permission` for a permission not in `facilis.config.ts` |
| `GET /__facilis/*` | Manifest sections | 404 in prod, origin allowlist |

**No log endpoint (D-119).** Logs are not a dev endpoint and have no route: the framework writes
JSON Lines files under `<project>/.facilis/logs/` (or stdout in production), and the IDE's Logs
view reads them through the kernel VFS. Adding a server route that serves log files would turn an
operator artifact into a remotely readable one; it is explicitly out of contract.

---

## 12. Development Phases

### Phase 0 — Feasibility Spike (1–2 weeks)

**Goal:** Prove the pipeline works before writing framework code.

| Task | Pass condition |
|---|---|
| Fork Vivari Studio; run locally | Editor opens, VFS works |
| Starter with `vite.config.ts` registering `facilis()` (which mounts Nitro) | `vite dev` boots |
| Vivari runs `vite dev` on starter | Preview renders |
| `experimental.openAPI: true` (a Facilis default); fetch `/_openapi.json` from Vite origin | Spec reachable |
| Write via `vivari.fs.writeFile` | Client HMR fires, server worker reloads |
| `vivari.fs.writeFiles` batch | Multi-file write works |
| `isomorphic-git` commit with `fs: vivari.fs` | Commit succeeds, HMR not disrupted |
| Kill/reboot Vivari | Uncommitted changes survive (OPFS mirror) |
| PGlite RLS smoke test | `ENABLE RLS` + `current_setting('app.roles')` filter works |
| `getTableConfig()` returns `policies` + `enableRLS` | Both non-empty |
| `defineRouteMeta` inside wrapper emits `x-db-tables` in OpenAPI | Verified |
| `?format=summary` manifest < 500 tokens | Measured |

**Exit criteria:** All green lights. **Test on macro-in-wrapper is the highest-risk item.** If it fails, fall back to a framework-owned AST pass.

### Phase 1 — Core Packages (2–3 weeks)

- `@facilis/core`: config, `defineAuthorizedHandler`, types, i18n
- `@facilis/db`: PGlite adapter, `drizzle-policy`, RLS auto-gen
- `@facilis/auth`: session middleware, RBAC, auth tables, seed generator
- `@facilis/nitro`: Vite plugin + Nitro module, `/__facilis/*` routes

**Exit criteria:** Hand-written todo app using only these packages runs in Vivari via `vite dev`, is secure, has working roles/permissions, its OpenAPI includes `x-db-tables`.

**Status (2026-10-25): implemented and verified headlessly.** All four packages ship with tests
(175 across the workspace), `examples/todo-app` is the acceptance app, and
`examples/todo-app/scripts/verify-headless.sh` asserts the exit criteria over HTTP (auth,
RBAC, CRUD, RLS isolation, manifest contract, `x-db-tables`). The "runs in Vivari" half still
needs a browser/WebContainer harness (Phase 0 items A1-A3/A6/A8-A12).

### Phase 2 — Studio Extension (2 weeks)

- Fork Studio, strip demo content
- Add `applyPatch()` to `IdeController`
- Add ChatPanel skeleton (no AI yet)
- Add PAT entry + encrypted storage
- Multi-project registry + switcher
- Point preview at Vite origin (single port)

**Exit criteria:** Developer can clone, edit, see live preview, commit, push — without AI or visualizer.

### Phase 3 — Visualizers (2 weeks)

- ~~API Flow panel (React Flow, `/_openapi.json` → nodes/edges)~~ removed (D-095); the project
  graph from AST facts (D-092) is the visualizer
- Entity Explorer (schema + drift diff)
- Release Preview (schema migration + risk classification + RLS diff)
- Code jump: click node → Monaco opens file

**Exit criteria:** Hand-editing a route updates the graph within seconds. Drift between code and DB is visible.

**Status (2026-11-06): complete, with the API Flow removed.** Entity Explorer (D-083), the
project graph (D-092, which replaced the API Flow, D-095) and Release Preview (D-086) ship; the
code↔live drift and the project-graph refresh are covered by unit tests and by the browser
smoke. The Data Explorer now also has the query console and declarative views (D-097); its live
transport is kernel-mediated, so it no longer needs an embedded preview (O-011 keeps the
declared AST half and preview mode C). D-098 adds permission views (definer + declared
permission, chosen in the Create-view dialog), and D-099 adds the audited `facilis_system`
sudo context (§8.4.5) with a dedicated append-only audit log (the pipeline/retention is O-014).

### Phase 4 — AI Orchestration (2–3 weeks)

- Prompt builder + context assembly (Model A)
- AIResponse parser
- Patch validator (18 rules)
- Retry loop — implemented (D-100, no attempt cap since D-108): findings fed back, the model
  reads the files it rewrites with the PTC tools (D-103)
- `requires_confirmation` modal
- Diff view + per-file accept/reject
- Apply → OPFS → HMR → refresh manifest

**Exit criteria:** "Make a todo app" from blank starter produces a working, secure, authenticated app.

**Status (2026-11-02):** Model A (prompt + context), the response parser, the 18-rule validator
(D-084), the proposal/diff review and the apply path are implemented; the §9.4 repair loop
(D-100) is implemented too and the PTC tool runtime is the chat's only mode (D-103); the eval
corpus and browser matrix remain. The validator's warnings still
need a UI surface.

### Phase 5 — Retired: headless blocks (D-131)

Phase 5 planned a versioned `@facilis/blocks` supply chain (DataTable, ResourceForm, AuthGuard, …)
plus block discovery and `RoleAssignment`. The v2 frontend copies Base UI primitives into the
project (`src/components/ui`, D-090/D-096) and the AI writes pages against that owned source, so
there is no supply chain to register or discover; the skeleton package is deleted and
`RoleAssignment` is a generated page, not a block. The number is kept as a tombstone so later
phases and the decision log keep their numbers. i18n already ships (`@facilis/i18n-db`, §5.9).

### Phase 6 — Polish & MVP Demo (1–2 weeks)

- Starter repo template
- Demo script (< 3 minutes)
- Error surfacing in chat
- Version pinning (`nitro@3.x.x` locked)
- Docs: add-route, security checklist, roles quickstart

**Exit criteria:** Demo runs reliably on fresh browser session.

**Status (2026-11-02):** the starter template question is settled — the generated project is
`examples/todo-app`, and `starter/` stays empty until `@facilis/*` has a publish target (D-027,
D-062). The demo script is [`DEMO.md`](./DEMO.md) (three minutes, fresh browser, Mock provider
path included); its automated equivalent — `pnpm ide:smoke`, which drives the same flow on a real
headless Chromium — passed on a fresh profile on 2026-11-02. A human rehearsal is still pending,
as are the add-route/security-checklist pages.

### Phase 7+ — Post-MVP Backlog

- Model B tool surface
- OAuth device flow (GitHub done, D-082; GitLab/Gitea PKCE remains)
- Visual "add resource" wizard
- Flat-JSON data mode
- Column-level `GRANT`
- i18n catalog editor
- Collaborative editing (Yjs)
- OpenAPI contract diff (parallel Vivari boot)
- Log pipeline WORM/HMAC/external sinks and transaction-outcome entries (O-019)
- SSO depth: IdP-initiated SAML, SCIM, refresh/session sync, TOTP/WebAuthn (O-020)

---

## 13. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **PGlite RLS incomplete** | Kills "unbypassable" guarantee | Phase 0 spike; fallback to `drizzle-policy` only |
| 2 | **Nitro v3 churn** | Build breaks between upgrades | Pin exact version; upgrade deliberately with spike tests |
| 3 | **`defineRouteMeta` in wrapper not scanned** — **confirmed in Phase 0** | No `x-db-tables` in OpenAPI | Framework-owned static pass + OpenAPI facade is **required**; prototype verified in Phase 0, replaced on 2026-11-04 by `@facilis/analyze` facts with a parser injected from `rolldown/utils` (`packages/nitro/src/route-metadata.ts`, §6.9). Any project source edit invalidates the virtual module. |
| 4 | **OpenAPI incomplete** | AI generates wrong code | Augment with `/__facilis/manifest` |
| 5 | **Vivari memory/CPU limits** | Slow or crashes at ~50 routes | Lazy-load PGlite; measure; document limits |
| 6 | **AI hallucinates unguarded routes** | Security regression | Patch validator rejects before write |
| 7 | **COOP/COEP hosting** | Can't deploy Studio anywhere | Cloudflare/Netlify/Vercel recipes; `coi-serviceworker` fallback |
| 8 | **x-db-tables drift** | Visualizer draws wrong edges | Lint rule: handler imports `db` but no `x-db-tables` → CI fail |
| 9 | **Vivari OPFS write-behind lag** | Uncommitted work lost on crash | Call `vivari.fs.flush()` on `visibilitychange` |
| 10 | **AI over-fetches (Model B)** | Token cost explodes | Preload summary always; prompt: "aim ≤10k input tokens" |
| 11 | **Role drift between config and DB** | Security hole | `role_permissions` written only at migration time; validator rule 16 |
| 12 | **Vite plugin misconfiguration** | `/__facilis/*` unreachable, preview broken | `facilis()` mounts Nitro itself and `enforce: "pre"` delivers the options, so there is no registration order to get wrong (D-034); document in starter README |

---

## 14. Acceptance Criteria

### 14.1 Phase 0 (Go/No-Go)

All must pass:

1. Studio runs locally with VFS
2. Starter boots via `vite dev` with `facilis()` (which mounts Nitro)
3. `/_openapi.json` reachable on Vite origin
4. `vivari.fs.writeFile` triggers client HMR and server worker reload
5. `vivari.fs.writeFiles` batch works
6. `isomorphic-git` on VFS commits successfully
7. OPFS mirror restores VFS after reboot
8. PGlite RLS filters rows via `current_setting('app.roles')`
9. `getTableConfig().policies` returns policies
10. `x-db-tables` reaches OpenAPI via `defineAuthorizedHandler` — native scanner fails (Phase 0); verified via the framework AST pass
11. `?format=summary` < 500 tokens
12. `facilis()` mounts Nitro; plugin order in `vite.config.ts` does not matter

**Status (2026-10-28):** the browser half is scripted. `pnpm ide:smoke`
proves items 1-6, 10 and 12 *inside the WebContainer*: boot + preview, client HMR **and**
server handler reload on a VFS write, the framework batch write (`applyPatch`),
isomorphic-git init/status/commit on the VFS, `/_openapi.json` carrying `x-db-tables`, and
`facilis()` mounting Nitro in one `vite dev`. Items 8, 9 and 11 are covered by the
Phase 1 headless suites (`packages/db`, `packages/nitro`). Item 7's *restore* works for the
mirrored tree, but writes made after the dev server starts are not mirrored yet — a kernel
write-behind stall tracked in D-028. Item 6's remote half (A11, PAT clone) stays Phase 2
work because the Studio's git layer is local-only (D-025).

### 14.2 Phase 1

**Status (2026-10-25): met headlessly** except the Vivari/WebContainer half of the first item —
see `examples/todo-app/scripts/verify-headless.sh` and D-015.

- A hand-written todo app runs in Vivari via `vite dev`
- All routes use `defineAuthorizedHandler`
- RLS policies auto-generated for scoped tables
- Auth tables created, roles seeded from config
- `FACILIS_INITIAL_ADMIN` + `FACILIS_INITIAL_ADMIN_TOKEN` grant `admin` once, to the registration that presents the token (D-150)
- Email verification (D-156): with `auth.verification.enabled` an unverified login answers
  `403 email_unverified`, the single-use link verifies the account, and a pending account is claimed
  by a verified SSO identity
- `/__facilis/manifest` returns full manifest with no warnings
- Background jobs: a `server/jobs/**` definition runs in a system context and returns data;
  `ctx.jobs.enqueue` returns an id; a future-`runAt` job is inspectable and cancellable; a
  persisted queue survives a boot; the example app verifies it in
  `scripts/verify-headless.sh` (D-107)
- Binary storage: an attachment uploads as multipart (size-limited, `413` over the limit),
  is listed with its parent, downloads through the token-only `GET /api/files/:id?token=…`
  byte-for-byte, and a cross-user attach/delete is `404`; the example app verifies it in
  `scripts/verify-headless.sh` (D-116)
- Storage at rest: with `storage.encryption.enabled` the same attachment round-trip holds over
  AES-256-GCM ciphertext streamed through storage (the token-only download decrypts
  byte-for-byte), and a missing or malformed `FACILIS_STORAGE_ENCRYPTION_KEY` warns
  `storage_encryption_key_missing` / `storage_encryption_key_invalid` and degrades only the
  file routes (D-117)

### 14.3 Phase 4 (MVP)

- From blank starter, "make a todo app" produces:
  - Working preview
  - Authenticated routes
  - RLS-enabled tables
  - `x-db-tables` in OpenAPI
  - Passing validator (no errors)
- Total wall time: < 3 minutes
- Total cost (BYO key): < $0.50

### 14.4 Phase 6 (Release)

- Demo reproducible on fresh browser
- Multi-project switch works with dirty-state warning
- Release preview shows correct risk classification for a schema drop
- Uncommitted-change reminder fires within 5s of any write
- A new `manager` role added via config + migration works end-to-end in < 30s

---

## 15. Open Questions

To resolve during Phases 2 and 5, not before:

- **Starter repo count:** One "todo" template, or several (blog, dashboard, API-only)?
- **Private npm registry:** Publish `@facilis/*` internally or to public npm?
- **i18n key format:** Flat (`todos.title`) or nested (`todos.form.title`)?
- **Block discovery:** Scan `node_modules`, or explicit registration in `facilis.config.ts`?
- **AI model default:** Recommend one (e.g., Claude Sonnet) or leave entirely to BYO?
- **Release preview boot strategy:** Sequential Vivari boots (slow, accurate) or schema-only `?at=<oid>` (fast, incomplete)?

None of these block Phase 0 or Phase 1.

---

## Appendix A — Phase 0 Ticket List (concrete)

| # | Ticket | Pass condition |
|---|---|---|
| A1 | Fork Vivari Studio to repo | `pnpm dev` opens editor |
| A2 | Strip demo templates from Studio | Home page loads empty |
| A3 | Add "New Project" flow that mounts a local starter tree | Starter renders in preview |
| A4 | Starter's `vite.config.ts` registers `facilis()` (which mounts Nitro) | `vite dev` boots without errors |
| A5 | Facilis defaults supply `serverDir` and `experimental.openAPI` (overridable in `facilis.config.ts`) | `/_openapi.json` returns spec |
| A6 | Studio spawns `vite dev` in Vivari | Preview iframe loads React app |
| A7 | Studio fetches `/_openapi.json` from Vite origin | Spec visible in console |
| A8 | Test `vivari.fs.writeFile` | File appears in editor; client HMR + server worker reload |
| A9 | Test `vivari.fs.writeFiles` batch | Multi-file write works |
| A10 | Set up `isomorphic-git` with `fs: vivari.fs` | `git status` works on VFS |
| A11 | PAT modal + WebCrypto encryption in OPFS | Clone from GitHub succeeds |
| A12 | Test Vivari kill/reboot with uncommitted changes | Changes preserved in OPFS mirror |
| A13 | PGlite boots; `SELECT 1` succeeds | Query returns |
| A14 | PGlite RLS smoke test with `current_setting('app.roles')` | Row filtered correctly for admin vs non-admin |
| A15 | `getTableConfig` returns `policies` from `pgPolicy` | Non-empty array |
| A16 | `defineRouteMeta` inside `defineAuthorizedHandler` emits `x-db-tables` | Verified in `/_openapi.json` |
| A17 | `/__facilis/manifest` stub returns `{ revision }` | 200 JSON |

**Total: ~15 days for Phase 0.** If A16 fails, **stop and design the AST pass fallback** before continuing.

---

## Appendix B — `facilis.config.ts` Reference

```typescript
import { defineConfig } from "@facilis/core"

export default defineConfig({
  release: {
    ref: "origin/main",
  },
  db: {
    mode: "pglite",
    migrationsDir: "db/migrations",
    tenantColumns: ["tenantId", "tenant_id"],
    ownerColumns: ["ownerId", "owner_id", "userId", "user_id"],
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  auth: {
    permissions: [
      "todos:read",
      "todos:write",
      "users:read",
      "users:manage",
      "admin:*",
    ],
    roles: {
      admin:   ["*"],
      manager: ["todos:read", "todos:write", "users:read"],
      user:    ["todos:read", "todos:write"],
      viewer:  ["todos:read"],
    },
    defaultRole: "user",
    sessionDurationMs: 1000 * 60 * 60 * 24 * 7,
    // Single sign-on (D-120): every key has a default; an empty list = passwords only.
    // The secret VALUES stay in the environment, named here by variable name.
    sso: {
      providers: [],                 // oidc | oauth2 | saml (discriminated union)
      failureRedirect: "/login",     // same-origin path; ?sso_error=<code> is appended
      stateTtlMs: 10 * 60 * 1000,    // login-attempt lifetime
    },
  },
  // Background-job queue (D-107): every key has a default, so the block is optional.
  jobs: {
    maxConcurrent: 2,      // attempts executing at the same time
    maxAttempts: 1,        // total attempts per job; 1 = no retry
    retryDelayMs: 5000,    // fixed delay before a retry
    timeoutMs: 30000,      // wall-clock bound of one attempt
    pollIntervalMs: 1000,  // scheduler tick
    persist: true,         // keep the queue in facilis_jobs
  },
  // Binary storage (D-116, optional at-rest encryption D-117): every key has a default.
  // The secrets stay in the environment (FACILIS_S3_* / FACILIS_STORAGE_SECRET and, when
  // encryption is on, FACILIS_STORAGE_ENCRYPTION_*), never here.
  storage: {
    driver: "local",       // "local" in dev; "s3" in production
    maxUploadBytes: 5 * 1024 * 1024, // default 10 MiB, hard cap 100 MiB
    tokenTtlSeconds: 300,  // download-token lifetime, max 24 h
    encryption: { enabled: false }, // opt-in AES-256-GCM at rest; false = plaintext (D-117)
    // With driver "s3": bucket + region are required; endpoint/forcePathStyle for R2/MinIO.
  },
  // Operator logging (D-119, optional): every key has a default; the sink is env-owned
  // (FACILIS_LOG_SINK/DIR/MAX_BYTES/KEEP/LEVEL) so a project cannot redirect the trail.
  logging: {
    level: "info",              // debug | info | warn | error
    access: true,               // one access entry per authorized request
    errors: true,               // server-side error entries
    includeUserAgent: false,    // less PII by default
    trustProxy: false,          // only a trusted deploy may set this
  },
  // Optional: Nitro options, passed through unchanged. Facilis supplies the framework
  // defaults (`serverDir: "./server"`, `experimental.openAPI: true`) underneath, so
  // declare only what you change. The IDE template, for example, needs the in-VM runner:
  nitro: { devServer: { runner: "self" } },
})
```

---

## Appendix C — Starter Route Reference

```typescript
// server/routes/api/todos/index.post.ts
import { z } from "zod"
import { defineAuthorizedHandler } from "@facilis/core"
import { todos } from "~/db/schema"

export default defineAuthorizedHandler(
  {
    permission: "todos:write",
    body: z.object({
      title: z.string().min(1),
      dueDate: z.string().datetime().optional(),
    }),
    dbTables: ["todos"],
    dbColumns: ["todos.title", "todos.dueDate", "todos.tenantId", "todos.ownerId"],
    description: "Create a todo for the current user.",
  },
  async (event, { body, auth, db }) => {
    const [row] = await db.insert(todos).values({
      ...body,
      ownerId: auth.userId,
    }).returning()
    return row
  },
)
```

**Nitro v3 has no auto-imports.** Route files must import every helper explicitly (`defineHandler`, `defineRouteMeta`, `HTTPError`, … from `"nitro"`). `defineAuthorizedHandler` is imported from `@facilis/core` and re-exports the types route authors need.

---

## Appendix D — Roles Quickstart

### Step 1 — Declare roles and permissions in `facilis.config.ts`

```typescript
auth: {
  permissions: ["todos:read", "todos:write", "users:manage"],
  roles: {
    admin:   ["*"],
    manager: ["todos:read", "todos:write"],
    user:    ["todos:read"],
  },
  defaultRole: "user",
}
```

### Step 2 — Re-export auth tables in `db/schema.ts`

```typescript
export * from "@facilis/auth/db"
export * from "./todos"
export * from "./documents"
```

### Step 3 — Generate and run migration

```bash
pnpm drizzle-kit generate
```

The plugin emits `CREATE TABLE roles`, `CREATE TABLE role_permissions`, `CREATE TABLE user_roles`, the RLS wiring (D-136: `sessions`/`user_roles` are app-scoped with an `EXISTS` policy over `users`; `roles`/`role_permissions` stay system-only), **and** the seed from your config.

### Step 4 — Set the initial admin (once, in `.env`)

```bash
FACILIS_INITIAL_ADMIN=founder@azienda.it
FACILIS_INITIAL_ADMIN_TOKEN=<one-time secret>
```

The registration that presents the token gets the `admin` role (one-time; D-150). The email alone
is not a credential, so knowing the address is not enough to become admin.

**Email verification (D-156, optional).** With `auth.verification.enabled` the registration sends a
single-use link. The framework never ships an SMTP client: the deployment sets
`FACILIS_EMAIL_WEBHOOK_URL` (the app POSTs `{ to, subject, text }`) and optionally
`FACILIS_EMAIL_WEBHOOK_TOKEN` (Bearer). In `development`/`test` without a webhook the account is
verified immediately, so demos and the IDE smoke run need no mailbox; production without the webhook
leaves the account pending and logs the delivery failure.

### Step 5 — Protect routes and tables

**In routes:** `defineAuthorizedHandler({ permission: "todos:write", ... })`.

**In RLS policies:** reference `current_setting('app.roles')::jsonb ? 'admin'` for role-based row filtering.

**Assign additional roles:** via `POST /api/users/:id/roles` (permission `users:manage`) or the `<RoleAssignment>` block.

---

## Appendix E — Vite + Nitro Quick Reference

### `vite.config.ts`

```typescript
import { defineConfig } from "vite"
import { facilis } from "@facilis/nitro/vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [facilis(), react()],
})
```

`facilis()` mounts Nitro and reads the project's Nitro options from the optional `nitro` section
of `facilis.config.ts` (Appendix B). The framework supplies `serverDir: "./server"` and
`experimental.openAPI: true`; a project overrides only what it changes. There is no
`nitro.config.ts`.

### `package.json`

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

### Where things live

| Concern | File / Directory |
|---|---|
| Vite plugins | `vite.config.ts` |
| Nitro options | `facilis.config.ts` (`nitro` section; framework defaults underneath) |
| Server routes | `server/routes/` |
| Facilis config | `facilis.config.ts` (repo root) |
| Drizzle schema | `db/schema.ts` |
| React app | `src/` |

**Remember:** `vite dev` is the only dev command. `nitro dev` does not support the Vite builder.

---

## Appendix F — Glossary

| Term | Meaning |
|---|---|
| **VFS** | Virtual File System inside Vivari's FS Worker; the authoritative filesystem |
| **OPFS** | Origin Private File System; browser API used by Vivari as write-behind mirror |
| **Vite** | The dev server. Serves client with HMR, hosts Nitro as a plugin. |
| **Nitro plugin** | Runs inside Vite. Serves API routes, OpenAPI, and server code in an isolated worker. |
| **Manifest** | `FacilisManifest` — the runtime projection returned by `/__facilis/manifest` |
| **Block** | A React component + `manifest.ts`, published to NPM, discovered by Studio |
| **Scoped table** | A Drizzle table with a column matching `tenantColumns` or `ownerColumns` |
| **RLS** | Row-Level Security — Postgres feature filtering rows by policy |
| **App role** | A role name defined in `facilis.config.ts` (`admin`, `manager`, …) |
| **Permission** | An atomic capability (`todos:read`, `users:manage`) declared in config |
| **Session var** | `SET LOCAL app.*` value set per request, read by RLS policies |
| **Risk class** | Classification of migration statements: safe, careful, destructive, breaking |
| **Model A / Model B** | AI context strategies: one-shot preload vs tool-use loop |
| **Patch** | A set of `FilePatch` entries returned by the AI, validated before writing |

---

**End of specification.**

This document is the contract. Every downstream artifact — the AI prompt, the visualizer, the release preview, the block manifests — derives from these types and rules. Lock this file, and the implementation is mechanical.

**Version history:**

- v1.2 — Renamed to **Facilis**. Corrected runtime: Nitro v3 as Vite plugin, `vite dev` single entry point, updated starter layout, new §10.6, Appendix E.
- v1.1 — Roles clarified: definition/assignment lifecycle (§8.4), app roles only, `FACILIS_INITIAL_ADMIN`.
- v1.0 — Design complete. Phase 0 ready.
