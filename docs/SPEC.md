# 📘 Facilis — Full Specification

**Version:** 1.34 (patch write scope follows the deployment profile, D-167)
**Status:** Phases 0–4 are complete and verified (headless suites + the browser harness, `pnpm ide:smoke`); Phase 5 is retired (D-131) and Phase 6 (polish + demo) is in progress; Phase 7+ is the post-MVP backlog. The current state is in [`STATUS.md`](./STATUS.md); the phase table is §12.
**Purpose:** Single source of truth for development

**Changelog:**

- v1.34 — Rule 11's write scope follows the deployment profile (D-167). `validatePatch`
  gains a `writePolicy` of `"open" | "managed"` and defaults to `managed` (fail-closed);
  rule 11 keeps its id and severity. `managed` is unchanged — the six project roots plus
  `facilis.config.ts` — and never accepts a `.github/workflows` file. `open` allows any
  project-relative path except the install surface (`package.json`, lockfiles, `.npmrc`),
  `node_modules`, the unreviewed VCS/IDE/build state (`.git`, `.facilis`, `dist`, `.turbo`,
  `coverage`) and `AGENTS.md`, so root config (`index.html`, `vite.config.ts`,
  `wrangler.jsonc`) and `.github/**` become writable. The IDE maps the policy from its build
  profile (D-063) and the system prompt states the effective rule. §5.5/§9.3 follow.
- v1.33 — Generated projects install the published packages (D-166). Every `@facilis.dev/*`
  dependency is an exact version resolved from npm like any other package: the IDE build injects
  the release version through `FACILIS_PACKAGES_VERSION` and the template pins all framework
  dependencies to it, so the generated tree no longer carries `vendor/` tarballs or
  `scripts/vendor-paths.cjs`, and the IDE no longer inlines package bytes into the create
  request. Publishing rides the IDE deploy workflow instead of a separate one: the publish job
  runs first only when `packages/**` changed (or via the workflow_dispatch `publish` input), the
  publish script verifies the registry, and the build pins the version it just published.
  §4.1/§4.2 follow.
- v1.32 — Published packages (D-164). The framework packages publish to public npm under the
  organization scope `@facilis.dev`; every `@facilis/*` name in this spec is now
  `@facilis.dev/*` (imports, generated-project template, vendored tarballs, lockfile). Outside the
  IDE a project installs them from the registry; inside it keeps installing the tarballs the IDE
  serves (D-022). The manifest that reaches npm is staged (exports resolve to `dist/`, internal
  deps are pinned to the release version, no devDependencies/scripts), and `starter/` is unblocked
  (D-027). §4 and the package sections follow.
- v1.31 — Job table declarations (D-162). `defineJob` now requires `dbTables` (tables and views by SQL name, `[]` = no relation) and accepts the `rawSql` exception; the old `tables` field is gone. A job attempt runs through the same runtime guard the routes use: an undeclared relation fails closed with `table_not_declared`, `db.execute` without `rawSql: true` with `raw_sql_not_allowed`, and a violation is terminal (not retried, stable code). The sudo audit records the declared set and, on `succeeded`, the observed relations. `@facilis.dev/analyze` reads `server/jobs/**` into `jobs`/`jobRelations` facts with `job-definition`/`job-definition-static` (warnings), `job-table-undeclared`/`job-table-unresolved`/`job-raw-sql` (errors) and `job-table-unused` (warning); `jobs-gate.test.ts` gates the examples (D-154 pattern) and the AI validator gains rule 19 `job-table-declared`. A workflow declares no tables: its surface is derived from the jobs its steps reference (`workflowTables`, `workflow-job-unknown`). §5.6/§7.9/§8.4.6/§9.3 follow.
- v1.30 — Workflows and manual tasks (D-135, D-161). A workflow is a named, ordered chain of job and approval steps in `server/workflows/**/*.ts` (`defineWorkflow`), advanced by a runtime tick over `facilis_workflows` rows, never a job body that waits; a manual step inserts a durable `facilis_tasks` row and the chain suspends until the task's status/decision changes through the app's authorized route (`ctx.tasks.decide`); a rejection either fails the run or continues at a declared forward step (`onReject`), a step may assign its task to a permission, and every transition is a compare-and-set short transaction with boot recovery and cancellation. The server-only `ctx.workflows`/`ctx.tasks` surface has no HTTP endpoint of its own, exactly like `ctx.jobs`. Workflow definitions are also project-graph nodes (D-161): `@facilis.dev/analyze` reads every default export of `server/workflows/**` (name, job/approval steps, assignment permission, forward reject target) into `WorkflowFact`s, and the graph gains a workflow node per definition with its own column and inspector; there is deliberately no Studio tasks inbox tab. §5.6/§7.1/§7.4/§7.10/§8.4.5/§10.2 follow.
- v1.29 — Docs consolidation: phase plans, resolved open questions and the Phase 0 ticket list leave the spec; no contract change.
- v1.28 — Le viste entrano nel project graph (D-160). `@facilis.dev/analyze` produce un nodo `view` per ogni `defineView` (`db/views/**`) con modalità invoker/definer, permesso e tabelle base dichiarate; una route che dichiara la vista in `dbTables` prende un arco `route-view` (marcato elevato dentro un'elevazione audited) e la vista è collegata alle tabelle base con `view-base`. L'IDE mostra le viste nella colonna dello schema sotto le tabelle, con badge e "usata da N rotte", e l'inspector elenca le rotte. Il contratto del grafo guadagna il nodo `view` e i due tipi di arco; i file di layout restano v3. §10.2/§11.2 follow.
- v1.27 — Il generatore (P2, D-158). `@facilis.dev/core` espone `planSchema(from, to)`: batch SQL ordinati per la fase §2.5 con rischio per batch, lista `destructive`, precondizioni `requires` e problemi solo-macchina; un piano con problemi non produce batch. Lo snapshot dichiarato (§7.3) guadagna PK ordinata, indici, check, unique ed enum, e `isPrimaryKey` copre le PK composte; enum alterati, colonne identity/generated, indici non semplici, PK cambiate, FK pendenti e policy allargate falliscono chiusi. Il renderer D-109 orfano e' stato rimosso.
- v1.26 — Il DDL nasce al rilascio, non si scrive a mano (D-158/D-159). La release pipeline genera un artefatto immutabile dal diff fra il tag del rilascio precedente e il tag nuovo, senza accesso al database; `facilis db deploy --release <tag> --backup-ref <ref>` applica gli artefatti pendenti in ordine con il ledger `_facilis_deploy_runs`, fingerprint preflight, `backup_ref` per i distruttivi e post-step (seed, `ensureAppRole`, `ensureSystemRole`, views). Il catalogo live resta verifica e adozione/riparazione; drizzle-kit non e' un deploy step ne' una dipendenza runtime. §2/§4.2/§5.2/§5.3/§7.7/§8.3/§8.4.2/§9.3/§11.1/§11.2/§11.3/App. D follow.
- v1.25 — `dbTables` è una dichiarazione applicata (D-157): ogni route dichiara tutte le relazioni che tocca, **tabelle e viste**, e il framework la verifica staticamente (analyzer con follow delle chiamate locali, gate CI, nuova regola 18 `route-table-declared`) e a runtime (guard su `ctx.db` e sulle elevazioni: `table_not_declared`, `raw_sql_not_allowed`); `rawSql: true` è l'unica deroga per `db.execute`, e l'audit delle elevazioni registra le tabelle osservate. §7.4/§8.4.6/§9.3/§11.2 follow.
- v1.24 — Email verification (D-156). `auth.verification` (default disabled) abilita il flusso: la registrazione crea l'account con `users.email_verified_at` NULL e un link monouso (token hashato in `auth_email_verifications`, TTL 24 h), il login del blueprint rifiuta `403 email_unverified` finché l'indirizzo non è verificato, e la route `GET /api/auth/verify-email` consuma il link con un redirect sicuro. La delivery è del deploy (`FACILIS_EMAIL_WEBHOOK_URL`/`_TOKEN`); in `development`/`test` senza webhook il blueprint verifica subito (demo e smoke senza casella). Il link SSO a un account password ora si basa sulla verifica: un account verificato si collega, un account pendente viene reclamato dall'identità verificata con rimozione della password segnaposto (chiude SEC-02 alla radice). §5.1/§5.3/§8.4.4/§4.4/§12 follow.
- v1.23 — Security hardening (review 2026-11-10): email canonica (`normalizeEmail`) e indice unico `lower(email)`, bootstrap del primo admin con token monouso `FACILIS_INITIAL_ADMIN_TOKEN` (D-150); link SSO verso un account password rifiutato di default (`auth.sso.linkPasswordAccounts`, D-151); throttle per route nel wrapper (`rateLimit`, chiave client address + route, D-152); cap dei byte del body prima del parsing e nuovo codice `payload_too_large` = 413 (D-153); gate CI che esegue l'analyzer sulle route di `examples/` e rifiuta wrapper non valido o `dbTables` assente (D-154). §5.1/§5.3/§7.4/§8.2/§8.4.1/§8.4.3/§8.6/§12 follow.
- v1.22 — Session id memorizzato come SHA-256 (D-144); coda gated da `jobs:read`/`jobs:exec` nelle policy RLS (D-145); rilevamento produzione fail-closed (D-146); SAML richiede `InResponseTo` (D-147); PBKDF2 600k + login a tempo costante (D-148); rate limiter del token endpoint con mappa limitata (D-149).
- v1.21 — Il token endpoint e' rate-limited (D-143). `auth.apiClients.rateLimit` (default `windowMs: 60000`, `maxRequests: 30`) limita gli scambi per client id in una finestra fissa in-process; oltre il budget la route risponde `429 too_many_requests` (nuovo codice della registry chiusa O-002) con `retry-after`, prima di toccare il database, e audita il tentativo. La revoca resta per client: un client revocato invalida client e token in una transazione e non esiste revoca per singolo token. §7.1/§7.4/§8.6 follow.
- v1.0–v1.20 — earlier versions are in the git history; their decisions are in DECISIONS.md.

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
3. See the project graph and live preview update in real time
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
| **Extensibility via NPM** | Components, resources, and auth flows are standard TypeScript packages. No plugin registry, no manifest file. |
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
| **AI mode** | PTC tool runtime: the model writes one JavaScript program per step against a read-only tool registry (D-101/D-103); patches remain the only source-write path |
| **Persistence** | Git (remote) = source of truth; OPFS = write-behind mirror via Vivari |
| **Git auth** | GitHub: OAuth device flow (D-082); GitLab/Gitea/Forgejo: PAT or account password (D-081); token per operation, nothing stored |
| **Studio** | Static SPA, no backend, no accounts (git = identity) |
| **LLM** | BYO key, direct browser → provider |
| **Source of truth** | Code only. Visual layer is read-only projection. |
| **Multi-project** | One project per browser tab; opening the same project in a second tab is refused (D-033) |
| **Multi-tenancy** | Full RBAC per generated app |
| **Role model** | App roles only (defined in config, expanded to permissions). **No Postgres roles.** |
| **Schema DDL** | Never authored (no AI, no user). The release pipeline generates an immutable artifact from the previous-release-tag → new-tag diff, with no database access (D-158); the deploy applies the pending artifacts through a ledger and a schema fingerprint (D-159). |
| **Deploy** | `facilis db deploy --release <tag> --backup-ref <ref>` applies the release artifacts; hosting and the backup stay the environment's job (D-159). |
| **i18n** | From day one. Message keys everywhere. API returns codes. |

### 2.3 Framework Config Decisions

- `release.ref` — configurable per project, defaults to `origin/main`
- `facilis.config.ts` — lives at repo root, committed; the **only** project config (framework sections plus optional Nitro options)
- Git credential — GitHub signs in with the OAuth device flow; other hosts take a PAT (or an account password where allowed). Per operation, never sent to the LLM
- Migration ordering — derived from the release tag pair and the fixed statement phases; nothing is authored, so there is no ordering conflict to resolve (D-158)
- Roles & permissions — **declared in `facilis.config.ts`**, materialized as seed statements by the release artifact and applied by the deploy (D-158/D-159)
- Nitro config — the optional `nitro` section of `facilis.config.ts`; `@facilis.dev/nitro` owns the framework defaults (`serverDir: "./server"`, `experimental.openAPI: true`) and `facilis()` mounts Nitro (D-034)

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
| **`@facilis.dev/*` packages** | The framework itself. Installed in every generated project. |

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
│   ├── core/                 @facilis.dev/core
│   │   ├── src/
│   │   │   ├── config.ts             defineConfig()
│   │   │   ├── route.ts              defineAuthorizedHandler()
│   │   │   ├── manifest.ts           BlockManifest, FacilisManifest types
│   │   │   ├── i18n.ts               t(), catalog registry
│   │   │   ├── release.ts            ReleasePreview types
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── db/                   @facilis.dev/db
│   │   ├── src/
│   │   │   ├── client.ts             Drizzle + PGlite adapter
│   │   │   ├── policy.ts             drizzle-policy wrapper
│   │   │   ├── rls.ts                RLS policy helpers rendered into the artifact
│   │   │   ├── diff.ts               ReleasePreview engine
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── auth/                 @facilis.dev/auth
│   │   ├── src/
│   │   │   ├── middleware.ts         session middleware
│   │   │   ├── session.ts            Lucia-style sessions
│   │   │   ├── rbac.ts               hasPermission(), expandRoles()
│   │   │   ├── db.ts                 users, sessions, roles, role_permissions, user_roles schema
│   │   │   ├── seed.ts               generates role seed from config
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── storage/              @facilis.dev/storage (D-053)
│   │   └── src/              content-addressed blobs, local + S3-compatible drivers, signed tokens
│   │
│   ├── time/                 @facilis.dev/time (D-056)
│   │   └── src/              Intl formatting, calendar days, DST-aware day bounds
│   │
│   ├── i18n-db/              @facilis.dev/i18n-db (D-057)
│   │   └── src/              translated content fields + optional catalogue overlay
│   │
│   ├── ai/                   @facilis.dev/ai
│   │   ├── src/
│   │   │   ├── prompt.ts             system prompt builder
│   │   │   ├── context.ts            context assembly (A vs B)
│   │   │   ├── parser.ts             AIResponse parser
│   │   │   ├── validator/            patch validator (19 rules)
│   │   │   ├── tools/                Model B tool definitions (Phase 4.5)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── nitro/                @facilis.dev/nitro (Vite plugin + Nitro module)
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
├── starter/                  user-cloned template (D-027), unblocked now that the
│                             packages publish by name (D-164) and install from npm at
│                             the IDE build's pinned version (D-166); generated from
│                             examples/todo-app at IDE build time (D-062) — no drift
│
├── examples/
│   ├── todo-app/             full-stack template source (v2: Tailwind + shadcn copy-in
│   │                         components, D-090) + Phase 1 acceptance app
│   ├── showcase-app/         static template source (Vite + React + Tailwind, no backend,
│   │                         D-168)
│   └── starter-app/          empty full-stack template source (standard login only, D-168)
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
│   └── views/                    SQL views declared with defineView (D-097), one file per view
├── locales/en.json, it.json
├── .facilis/                     dev-only state, never source: db/snapshot.tar.gz, binary/, logs/*.jsonl (D-119)
├── index.html
├── vite.config.ts                plugins: [tailwindcss(), facilis(), react()]
├── facilis.config.ts             the one config: roles, permissions, storage, nitro options
├── tsconfig.json
├── package.json                  scripts.dev = "vite dev"; @facilis.dev/* pinned exactly (D-166)
├── scripts/                      check-pm.mjs
└── README.md
```

**Note:** the generated tree **is** the template's example app (D-062), not a separate
scaffold: the IDE inlines that source at build time and adds only the files the IDE owns —
`.facilis/facilis.app.json`, the generated `package.json`, the standalone `tsconfig.json`,
`.npmrc`, `README.md` and `scripts/check-pm.mjs` (D-168). The layout above is the full-stack
template (`examples/todo-app`), which also gets the liveness `ping` route, the HMR hint/style
and the in-process Nitro runner. The static template (`examples/showcase-app`) is the same
IDE-owned files over a plain Vite + React + Tailwind tree — no `server/`, `db/` or
`facilis.config.ts`, and its `package.json` carries no `@facilis.dev/*` dependency. The empty full-stack
template (`examples/starter-app`) has the same layout and wrappers with the login-only
surface — auth routes, pages, schema and migrations, no todo/file/job route or page — and gets
the in-VM Nitro runner override. New
projects pick a template in Home's New project dialog (D-168); the run manifest comes from the
template registry, not from the files. The acceptance probe runs from the IDE page, not inside
the app. Nitro v3 in Vite mode requires the server directory to be declared via `serverDir`.
`facilis()` mounts Nitro and supplies it from `facilis.config.ts`: the framework defaults are
`serverDir: "./server"` and `experimental.openAPI: true`, and a project overrides only what it
changes in the config's optional `nitro` section. Route files live under `server/routes/`, not
`routes/` at project root.

Every `@facilis.dev/*` dependency in `package.json` is an **exact version installed from npm**,
like any other dependency (D-166): the IDE build injects the release version through
`FACILIS_PACKAGES_VERSION` and the template pins every framework package to it (a dev build
without the variable pins the `0.1.0` fallback). The generated tree therefore carries no
`vendor/` directory and no tarball-path shim — `scripts/` holds only `check-pm.mjs` — and npm
fetches the framework packages when the project installs.

`db/migrations/` and its `meta/` journal are not part of the generated project: DDL is a release
artifact generated from the tag pair, never a directory the app carries (D-158).

---

## 5. Facilis Packages

### 5.1 `@facilis.dev/core`

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

// Logging (D-119): entry shapes + ctx.log contract; sinks live in @facilis.dev/nitro
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

// SSO config (D-120); the protocol lives in @facilis.dev/auth
export {
  DEFAULT_SSO_CONFIG, SSO_PROVIDER_KINDS, ssoConfigSchema, ssoProviderSchema,
} from "./sso-config"
export type {
  FacilisSsoConfig, FacilisSsoConfigInput, FacilisSsoProvider, SsoProviderKind,
} from "./sso-config"
```

### 5.2 `@facilis.dev/db`

Exports:

- `createDb(options)` — Drizzle client for PGlite (dev) / Postgres (prod). Dev PGlite is
  in memory; `snapshot()` serializes the cluster, `loadSnapshot` restores it, and
  `activity()` counts client operations so the dev snapshotter can skip idle ticks (D-052).
  The postgres driver (D-068) opens a `pg` pool lazily, has no cluster dump (a postgres
  `snapshot()` rejects), and is reached with the deployment's least-privileged
  `facilis_app` role, so RLS is enforced by the database rather than by a privileged client
- `policyContext` — `drizzle-policy` wrapper for tenant/role scoping
- `rlsForTable`, `tenantIsolationPolicy`, `ownerIsolationPolicy`, `rolePolicy` — RLS policy helpers declared in `db/schema.ts`; the release generator renders them into the artifact (D-158)
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
  policy, re-exported by the project's `db/schema.ts` so the generated release artifact owns its DDL
  (D-107, D-158).
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
  counterpart, takes the job's required `dbTables` (possibly `[]`, D-162) and the `rawSql` flag,
  guards the elevated client with that declaration and audits the observed relations; `ctx.sudo`/
  `ctx.system` still require a non-empty subset of the route's `dbTables`

### 5.3 `@facilis.dev/auth`

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
- `seedFromConfig(config)` — renders the `roles`/`role_permissions` seed statements from `FacilisConfig.auth`; the deploy applies them as a post-step (D-159)
- `registerInitialAdmin()` — grants `admin` once, when the registration's canonical email matches `FACILIS_INITIAL_ADMIN` AND the caller presents the operator's `FACILIS_INITIAL_ADMIN_TOKEN` (D-150); the email alone is not a credential
- `normalizeEmail(email)` — canonical email form (trim + lowercase) used by every auth lookup, insert and comparison; `users` carries a unique `lower(email)` index (D-150)
- Email verification (D-156): `issueEmailVerification()`, `consumeEmailVerification()` and `markEmailVerified()` own the single-use token (`sha256(token)` in `auth_email_verifications`, TTL from `auth.verification.tokenTtlMs`) and the `users.email_verified_at` transition; delivery is the project's, never the framework's
- Login/logout/register route blueprints (optional to install)
- Role-assignment API blueprint (`POST /api/users/:id/roles`)
- Single sign-on (D-120): `ssoProviderList()` (the public provider list), the start/callback orchestration for OIDC/OAuth2/SAML, the `auth_identities` and `auth_sso_states` tables, and the framework-owned routes `GET /api/auth/sso/providers`, `GET /api/auth/sso/:provider/start` and `GET|POST /api/auth/sso/:provider/callback` (implemented by `@facilis.dev/nitro`)

**Auth tables (from `@facilis.dev/auth/db`):**

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored canonical (lowercase); unique index on lower(email) (D-150)
  tenantId: tenantColumn(), // @facilis.dev/db: uuid NOT NULL DEFAULT app.tenant_id (D-040)
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

// System-only (D-136): no RLS, no privilege for facilis_app. Seeded by the deploy post-step and
// never read at runtime — permissions reach the app from facilis.config.ts via expandRoles().
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

**Critical:** the `role_permissions` table is a **projection** of `facilis.config.ts`. It is seeded by the deploy's seed post-step and never written at runtime (D-159).

**Single sign-on (D-120).** A provider is declared in `auth.sso.providers` (OIDC, generic OAuth2 or SAML); the config names the ENV VAR that holds its secret, never the secret. The flow is authorization-code based: a single-use state row (plus PKCE verifier, OIDC nonce or SAML request id) is written before the redirect, the callback consumes it once, identity resolution and user/role/identity writes run inside the audited `ctx.system` elevation, and the session is created with `createSession` + the framework cookie helper. An unverified email never links to or provisions a user; `autoProvision` (default true) creates one with a null password hash and the provider's role. The public provider list hides a provider whose secret/certificate env var is missing. Email verification (D-156) decides the linking rule: a VERIFIED password account links (the mailbox is proven), while a pending one is claimed by the identity — its placeholder password is removed and the account marked verified — so an attacker who merely registered the address first cannot keep it. See `docs/SSO.md`.

### 5.4 `@facilis.dev/blocks` — removed (D-131)

The headless-blocks package never shipped and is retired: the template v2 frontend copies Base
UI primitives into the project (`src/components/ui`, D-090/D-096) and the AI writes pages against
that owned source, so a versioned block supply chain has no consumer. The skeleton package is
deleted (§12 keeps the Phase 5 number as a tombstone). The `BlockManifest` type and the
manifest `blocks` section stay as a reserved, always-empty slot (§7.2/§7.3); dropping them is a
manifest revision, not part of this retirement.

### 5.5 `@facilis.dev/ai`

Exports:

- `buildPrompt(manifest, mode)` — system prompt (A or B variant)
- `assembleContext(vivari, manifest, openFiles, diff, mode)` — preload builder
- `parseResponse(raw)` — AIResponse parser
- `buildProjectContext(input)` — projects an `Analysis` (+ optional pre-patch one) into the
  typed validator context; the caller supplies the facts (the IDE from the analyzer worker)
- `validatePatch(patches, { context, requiresConfirmation, allowedRootFiles, writePolicy })` —
  19-rule validator over analyzer facts (D-092); `writePolicy` selects rule 11's write scope
  (`"open" | "managed"`, default `"managed"`, D-167); the main entry stays browser-safe and the
  only parser is the injected syntax checker
- `applyPatch(controller, patch)` — writes through `kernel.writeFiles`

### 5.6 `@facilis.dev/nitro` — Vite plugin + Nitro module

This package has **four entry points**: the Vite plugin (which also mounts Nitro), the Nitro module it carries, the route-facing session-cookie helpers, and the route-facing binary-storage helpers (D-116).

**Entry 1 — `@facilis.dev/nitro/vite` (Vite plugin + Nitro mount):**

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
`@facilis.dev/analyze` (parser injected from `rolldown/utils`), maps the route facts to the
manifest/OpenAPI contract and invalidates on any project source edit. `facilis()` takes no
options; the analyzer owns the DSL layout (`server/routes/**`, `server/api/**`).

**Entry 2 — `@facilis.dev/nitro` (Nitro module):**

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

**Framework middleware, logging and SSO routes.** The module registers the `context` (db) and `session` (auth) middleware on `/**`, in that order. Its runtime also owns the logging pipeline (D-119): the `runtime/logging/` module resolves the sink from the environment, appends JSON Lines to `<project>/.facilis/logs/` or stdout, and is attached to every request by the context middleware, which also resolves/returns `x-request-id`. Access/error entries are produced by `defineAuthorizedHandler` in `@facilis.dev/core`; the sudo trail is bridged in from `@facilis.dev/db`. No route exposes the log files.

When `auth.sso.providers` is non-empty, the module also registers one handler for `/api/auth/sso/**` (D-120) in dev and production alike. The handler is a normal `defineAuthorizedHandler` with `permission: []`: it lists the public providers, starts a login (302 to the IdP) and completes the callback (302 back to `redirectTo`). SAML's ACS POST body is parsed and Zod-validated inside the handler, and `@node-saml/node-saml` is imported lazily so projects without SAML never load it.

**Registration in the starter's `vite.config.ts`:**

```typescript
import { defineConfig } from "vite"
import { facilis } from "@facilis.dev/nitro/vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [facilis(), react()], // facilis() mounts Nitro; order in this array does not matter
})
```

**Nitro options in `facilis.config.ts`:**

```typescript
import { defineConfig } from "@facilis.dev/core"

export default defineConfig({
  // ...release, db, i18n, blocks, auth
  nitro: {
    // pass-through Nitro options; only what differs from the framework defaults
    devServer: { runner: "self" }, // the in-VM template's constraint (D-034)
  },
})
```

`facilis.config.ts` is the only Nitro config a project has. The framework defaults it overlays are `serverDir: "./server"` and `experimental.openAPI: true`; a project that still keeps a `nitro.config.ts` keeps working (Nitro's c12 loader reads it) but `facilis.config.ts` wins, and new projects never create one.

**Entry 3 — `@facilis.dev/nitro/session` (session-cookie helpers for routes):**

```typescript
// packages/nitro/src/session-cookie.ts
import { SESSION_COOKIE_NAME } from "@facilis.dev/auth"
import type { FacilisRequestEvent } from "@facilis.dev/core"
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

**Entry 4 — `@facilis.dev/nitro/storage` (upload/download helpers for routes, D-116):**

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

**Why separate entry points?** Vite plugins can extend Nitro programmatically by exposing a `nitro` key (a Nitro module) on the plugin object, and Nitro's own plugin mounts by returning `Plugin[]`. `facilis()` is both: it returns the Facilis plugin carrying the module, followed by `nitro()`'s plugins. The user writes one plugin in `vite.config.ts` and gets Nitro plus all `__facilis` routes, virtual modules, and collectors. The session and storage helpers are their own entry points because they are server-runtime code: the session helpers import h3 while core's route contract does not (contracts §4.1), so the single `FacilisRequestEvent` → `H3Event` narrowing lives there and a handler stays free of h3 imports; the storage helpers are where `@facilis.dev/nitro` implements core's `StorageApi` over the Node-only `@facilis.dev/storage` package, which core itself must not depend on.

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
  semantics). A project without the table degrades to the in-memory store with a
  `jobs_table_missing` warning; a runtime that fails to start is a `jobs_boot_failed` warning, and
  a scheduler/store failure during a tick is a `jobs_runtime_error` warning. Boot never fails
  because of jobs, and a handler whose `ctx.jobs` is the unavailable fallback rejects every call
  with `JobError("job_unavailable")` instead of failing the route.
- **System context and table declaration.** Every attempt runs through `runAsSystem` (actor
  `system:job:<name>`, operation `jobs:<name>`) in its own `facilis_system` transaction. The
  definition's required `dbTables` (tables and views; `[]` = none) is an applied declaration
  (D-162): the system client is guarded by it, so an undeclared relation fails closed with
  `table_not_declared` and `db.execute` without `rawSql: true` with `raw_sql_not_allowed`. The
  violation is terminal — the attempt is not retried and the job error stores the stable code.
  The job body receives that guarded system client, never the app client.
- **Audit and static checks.** The sudo trail records the declared `dbTables` on
  `started/succeeded/failed` and the relations actually observed on `succeeded`
  (`observedTables`); a failure entry carries the canonical code, never the relation name.
  `@facilis.dev/analyze` reads every definition into `jobs`/`jobRelations` facts and reports the job
  diagnostics (§8.4.6); `jobs-gate.test.ts` fails a project whose jobs break the declaration
  (D-154 pattern) and AI validator rule 19 covers patches (§9.3). Jobs are not project-graph
  nodes yet.
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

**Workflows and manual tasks (D-135).** A workflow is a named, ordered chain of job and
approval steps, advanced by the same server process that runs the jobs. The design reference is
[`WORKFLOWS.md`](./WORKFLOWS.md); the public types are §7.10.

- **Definitions** are one default export per `server/workflows/**/*.ts` (`defineWorkflow`), nested
  directories allowed, `*.test.ts` ignored. The Nitro module registers the `#facilis/workflows`
  virtual module, rendered as `WorkflowModule[]`; an invalid or duplicate definition becomes a
  `workflow_definition_invalid` manifest warning and is skipped, never a boot failure.
- **Runtime tick.** With `workflows.persist` and both migrated tables the runner expires due tasks,
  resumes waiting runs whose task settled, advances running runs whose step job settled, and
  dispatches the current step. Every transition is a compare-and-set short transaction, and the
  step job (or the approval task) and the workflow row change in the same transaction, so a
  hand-off is either fully there or not there. Boot recovers interrupted runs by re-dispatching a
  missing step job up to `jobs.maxAttempts`.
- **Manual steps.** An approval step inserts a `facilis_tasks` row and leaves the workflow
  `waiting`; nothing blocks in memory or in a transaction. The decision is the app-owned
  authorized write `ctx.tasks.decide` (the example guards it with `tasks:decide`); a rejection
  fails the run, or continues at the step named by `onReject` (a forward jump). Expiry is part of
  the tick; cancellation stops the in-flight job/task before settling the row.
- **`ctx.workflows`/`ctx.tasks` only.** There is deliberately **no HTTP endpoint** behind them — a
  project writes its own inbox/decide/start routes, with its own permissions and Zod bodies. Both
  APIs are also on `event.context.facilis.workflows`/`.tasks` for framework middleware; a runtime
  that did not boot leaves the unavailable fallback (`workflow_unavailable`/`task_unavailable`).
- **Config** is the three-key `workflows` section of `facilis.config.ts` (§7.1). v1 is linear: no
  branches/loops/fan-out/compensation, at-least-once step jobs, exactly-once decisions by CAS, no
  in-memory mode. An external signal is an app-owned webhook route deciding the pending task; a
  first-class signal step is out of scope.

### 5.7 `@facilis.dev/ui` — removed (D-096)

The v1 plain-CSS kit and its example apps are gone. Template v2 ships Tailwind CSS v4 + Base UI
with the shadcn-style components copied into the project (`src/components/ui`, §5.1).

### 5.8 `@facilis.dev/time`

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

### 5.9 `@facilis.dev/i18n-db`

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
  (`@facilis.dev/i18n-db/client`, drizzle-free) merging database rows over `locales/*.json` per
  key.

---

### 5.10 `@facilis.dev/storage`

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
| helpers | `@facilis.dev/nitro/storage` exports `storeUpload({ event, db, storage, auth, file })` — enforces `maxUploadBytes` from the file's size, streams the file into storage after the platform parsed the multipart form once, inserts the `facilis_files` row and returns `{ id, name, mime, size, url }` (or a `Response` rejection) — and `sendStoredFile({ db, storage, fileId, token, tenantId, responseName? })`, which verifies the token and returns the plaintext as a streamed response body with `content-length` from the stored plaintext size (dev, and any encrypted deployment) or redirects to a driver-presigned S3 GET (prod with encryption off) |
| template routes | `POST /api/todos/:id/files` (session + `storeUpload`, then the route inserts the generated link row), `DELETE /api/todos/:id/files/:fileId`, and `GET /api/files/:id?token=…` (permission `[]`, token-only); `GET /api/todos` carries each todo's attachments with a freshly signed URL (`null` when no driver booted) |
| access | the download route verifies a short-lived HMAC token carrying `fileId`, `tenantId`, `subject` and `expiresAt` (`buildDownloadUrl`, default 5 min). GET is token-only so `<img src>` and shared links work without a cookie; every mutation stays session-authenticated |
| multipart contract | `form` and `body` are mutually exclusive on `defineAuthorizedHandler`; a multipart request is consumed once by the wrapper, and the route validates fields with Zod while `maxUploadBytes` is enforced before the body is stored. A rejected upload is `file_too_large` (413) or `invalid_input` (400) |
| response headers | the stored mime is served with `x-content-type-options: nosniff`, an attachment `content-disposition`, `content-security-policy: sandbox` and `cache-control: private`, so user content never renders as a privileged same-origin page |
| errors | `file_too_large` (413) and `storage_unavailable` (503) join the core error registry (§7.4); the rest of the API is unaffected when storage is down |
| metadata | `facilis_files` — RESTRICTIVE `tenant_isolation` plus the PERMISSIVE `facilis_files_tenant_access` insert gate (a restrictive policy alone denies `facilis_app` the insert, D-008) — and the generated `fileLinks(parent, …)` tables, each with a restrictive tenant policy and the permissive `parent_access` inheritance (§5.2) |
| cleanup | no GC yet: bodies are immutable and deduplicated in plaintext mode (encrypted blobs are unique per upload), so orphans cost space only for content no longer referenced |

### 5.11 `@facilis.dev/analyze`

Zero-build static analysis of the project's declarative DSL (D-092). It reads a path → source
map with an injected `Parser` and returns the fact model — routes, config,
tables/columns/policies, FK and `relations()` edges, pages/consumers, per-file module facts
(imports, literal `t()` keys, bare calls), locale catalogs — plus diagnostics and the single
project graph, **without executing project code**. The main entry is browser-safe and has no
runtime parser dependency; adapters live on subpaths: `./node` (oxc-parser native/wasm, CLI
and CI) and `./fs` (the Node filesystem loader, no parser). The IDE worker supplies the browser
wasm parser; `@facilis.dev/nitro` supplies `rolldown/utils` because the generated project's Vite
config runs inside the WebContainer, where only the bundler's oxc is proven to load. Unknown
values are explicit (`null`/unknown entries, never defaults), the DSL is forced by the
`defineAuthorizedHandler`/`defineConfig`/`pgTable`/`api()`/`t()` contract, and the runtime
wrapper remains the security boundary. Used by the IDE project graph and patch validation, the
AI validator, and the Nitro manifest/OpenAPI facts. The browser IDE supplies the installed framework declarations it would otherwise lack by inlining `@facilis.dev/auth` and `@facilis.dev/db`'s source at build time (D-130), so re-exported framework tables and their edges reach the graph without a `node_modules` crawl.

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

**Phase 0 result (verified, 2026-10-25): Nitro's scanner only accepts a *top-level* `defineRouteMeta` call. A call inside the wrapper is invisible to it, so the native path does not work (A16 = fail).** `@facilis.dev/nitro` therefore ships a framework-owned static pass that reads the wrapper config into a virtual module, plus a facade that merges it into Nitro's generated spec and serves it at `/_openapi.json`. Nitro's own spec stays intact on an internal dev-only route (`/_facilis/openapi.json`).

**Implementation (2026-11-04, D-092/D-093).** The pass is `@facilis.dev/analyze`'s route facts, not
a Nitro-local scanner: `packages/nitro/src/route-metadata.ts` maps `RouteFact[]` to the
manifest/OpenAPI contract and `packages/nitro/src/rolldown-parser.ts` injects `rolldown/utils`
as the parser. That parser choice is deliberate: the generated project's Vite config is loaded
inside the WebContainer with `--configLoader native`, where only the bundler's oxc is proven to
load, so `@facilis.dev/nitro` must not pull `@facilis.dev/analyze/node` (oxc-parser) into the VM. The
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
    migrationsDir: string   // legacy dev-replay directory; release DDL is a generated artifact (D-158)
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
  enums?: EnumSnapshot[]                       // enum types referenced by columns (D-158)
}

interface TableSnapshot {
  name: string
  rlsEnabled: boolean
  columns: ColumnSnapshot[]
  foreignKeys: ForeignKeySnapshot[]
  policies: PolicySnapshot[]
  scopeColumn?: { name: string; kind: "tenant" | "owner" }
  primaryKey?: string[]                        // ordered PK columns; empty when none
  indexes?: IndexSnapshot[]
  checks?: CheckSnapshot[]
  uniqueConstraints?: UniqueConstraintSnapshot[]
  unsupported?: UnsupportedDeclarationSnapshot[]  // readable but not renderable: the generator fails closed
}

interface ColumnSnapshot {
  name: string
  type: string
  notNull: boolean
  default: string | null
  isPrimaryKey: boolean                        // also true for a composite PK member (D-158)
  isUnique: boolean
  identity?: "always" | "byDefault"            // not renderable in v1: the generator refuses
  generated?: true                             // computed columns: same fail-closed treatment
}

interface IndexSnapshot { name: string; columns: string[]; unique: boolean }
interface CheckSnapshot { name: string; expression: string }   // expression already rendered as SQL
interface UniqueConstraintSnapshot { name: string; columns: string[] }
interface EnumSnapshot { name: string; values: string[] }
interface UnsupportedDeclarationSnapshot { construct: "index" | "foreign_key"; name: string }

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

**`dbTables` is enforced (D-157).** The array declares **every** relation the handler may touch through `ctx.db`, `ctx.sudo` and `ctx.system`: tables and views, by SQL name (a view is declared by its own name, D-097/D-098; a definer view keeps its declared permission as the gate). It is not documentation: `@facilis.dev/analyze` follows the handler's project-local helper calls and reports an undeclared relation as `route-table-undeclared` (error), a declared-but-unused one as `route-table-unused` (warning), an unresolvable/dynamic relation as `route-table-unresolved` (error) and `db.execute` without `rawSql: true` as `route-raw-sql` (error); the CI route gate (D-154) runs the pass on the shipped examples and the AI validator rule 18 `route-table-declared` rejects a patch that breaks it. At runtime the wrapper **guards** the scoped client and the elevation callbacks: a relation outside the declared set fails closed with `500 table_not_declared`, raw SQL without the flag with `500 raw_sql_not_allowed`, and the violation is audited (`route:table_access`); inside `ctx.sudo`/`ctx.system` the observed tables must also be within the elevation's `tables`, whose `succeeded` audit entry records the observed set. Package calls are opaque statically (the runtime is the authority).

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
sink from `@facilis.dev/db` (D-099). The output is JSON Lines files
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
call `storeUpload`/`sendStoredFile` from `@facilis.dev/nitro/storage` (§5.10) or use
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
  kind: "destructive_without_approval" | "destructive_without_backfill" | "policy_broadened"
  message: string
  related?: string
}
```

The schema lens is the **generated tag → HEAD plan**: the same `planSchema` renderer the release
pipeline runs produces SQL batches and risk from the two declared snapshots, with **no database
access**. It **fails closed** wherever the analyzer cannot resolve a declaration, and the CI
artifact for the tag is authoritative; the preview never presents SQL that will not ship. This
supersedes the D-086 premise that the preview could not synthesize SQL (D-158/D-159).

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
  dbTables: readonly string[] // REQUIRED: tables and views reached via ctx.db; [] = none (D-162)
  rawSql?: boolean           // explicit db.execute exception; default false (D-162)
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
integer overrides, and the required `dbTables` array plus the boolean `rawSql`);
`isJobDefinition` is the structural guard the registry uses on a scanned module and requires
`dbTables` too. Both the input and the result cross a JSON round-trip (`serializeJobData`): what the queue
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
its own system transaction. Every attempt runs through `runAsSystem` with actor
`system:job:<name>` and the definition's `dbTables`/`rawSql`, so the job body always sees a
system-scoped transaction **guarded** by its declaration (§8.4.5, §8.4.6). A declaration
violation is terminal: the attempt fails with the stable code and is not retried.

### 7.10 Workflow and Manual-Task API

The workflow contract (D-135; design reference [`WORKFLOWS.md`](./WORKFLOWS.md)). A workflow is a
named, ordered chain of steps advanced by a runtime tick; a step is a job instance or a manual
approval. The chain is rows (`facilis_workflows`), never a suspended job body: a job body holds
its transaction on the single PGlite connection and cannot wait (§5.6). The API is server-only;
the framework owns no HTTP endpoint — the app writes its task inbox/decide and workflow start
routes.

```typescript
interface FacilisWorkflowsConfig {
  tickIntervalMs: number           // runner tick, minimum 100 (default 1000)
  persist: boolean                 // keep runs in facilis_workflows (default true)
  defaultTaskTtlMs: number | null  // default approval expiry; null = none (default null)
}

type WorkflowStatus = "running" | "waiting" | "succeeded" | "failed" | "cancelled"
type WorkflowStepKind = "job" | "approval"

interface WorkflowResolveContext<Input> {
  input: Input                        // the serialized start input
  steps: readonly (JobJson | null)[]  // outputs of completed steps; approvals are null
}

interface WorkflowJobStep<Input = unknown> {
  job: string
  input?: (context: WorkflowResolveContext<Input>) => unknown // absent = the chain input
}

interface WorkflowApprovalStep<Input = unknown> {
  approval: {
    titleKey: string   // flat i18n key, rendered with t(titleKey, params)
    params?: (context: WorkflowResolveContext<Input>) => Record<string, string | number>
    ttlMs?: number     // overrides workflows.defaultTaskTtlMs
    permission?: string // assignment: the permission a decider needs on the task
    onReject?: { step: number } // a forward jump on rejection; absent = the run fails
  }
}

type WorkflowStep<Input = unknown> = WorkflowJobStep<Input> | WorkflowApprovalStep<Input>

interface WorkflowDefinition<Input = unknown, Output = unknown> {
  name: string                       // start key, unique across the registry
  input: z.ZodType<Input>            // validated at start, stored serialized
  output?: z.ZodType<Output>         // validated before the run is "succeeded"
  steps: readonly WorkflowStep<Input>[]
}

function defineWorkflow<Input, Output>(
  definition: WorkflowDefinition<Input, Output>
): WorkflowDefinition<Input, Output>
function isWorkflowDefinition(value: unknown): value is WorkflowDefinition

interface WorkflowProgressEntry {
  index: number
  kind: WorkflowStepKind
  jobId?: string
  taskId?: string
  output?: JobJson                    // job steps only
  decision?: "approve" | "reject"     // approval steps only
}

interface WorkflowRecord {
  id: string
  name: string
  status: WorkflowStatus
  input: JobJson
  progress: readonly WorkflowProgressEntry[]
  currentStep: number                 // equals steps.length once succeeded
  currentJobId: string | null
  waitingTaskId: string | null
  attempts: number
  output: JobJson | null
  error: string | null                // coded failure kind plus message (server-only)
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

interface WorkflowListOptions {
  status?: WorkflowStatus | readonly WorkflowStatus[]
  name?: string
  limit?: number                      // default 50, capped at 200
}

interface WorkflowsApi {
  start(name: string, input: unknown): Promise<{ id: string }>
  get(id: string): Promise<WorkflowRecord | null>
  list(options?: WorkflowListOptions): Promise<WorkflowRecord[]>
  cancel(id: string): Promise<boolean>
  bindScope?(scope: PolicyScopedDatabase): WorkflowsApi
}

type TaskStatus = "pending" | "decided" | "expired" | "cancelled"
type TaskKind = "approval"
type TaskDecision = "approve" | "reject"

interface RequestTaskInput {
  titleKey: string
  titleParams?: Readonly<Record<string, string | number>>
  payload?: unknown                   // opaque JSON shown to the decider
  expiresAt?: string | Date
  assignedPermission?: string         // app-enforced assignment
}

interface TaskDecisionInput { kind: TaskDecision; comment?: string }

interface TaskListOptions {
  status?: TaskStatus | readonly TaskStatus[]
  workflowId?: string
  assignedPermission?: string
  limit?: number                      // default 50, capped at 200
}

interface TaskRecord {
  id: string
  workflowId: string | null           // set for a workflow step; null standalone
  stepIndex: number | null
  kind: TaskKind
  status: TaskStatus
  decision: TaskDecision | null
  titleKey: string
  titleParams: TaskJson
  payload: TaskJson | null
  requestedBy: string | null
  assignedPermission: string | null
  expiresAt: string | null
  decidedBy: string | null
  decidedAt: string | null
  comment: string | null
  createdAt: string
}

interface TasksApi {
  request(input: RequestTaskInput): Promise<TaskRecord>
  get(id: string): Promise<TaskRecord | null>
  list(options?: TaskListOptions): Promise<TaskRecord[]>
  decide(id: string, decision: TaskDecisionInput): Promise<TaskRecord>
  cancel(id: string): Promise<boolean>
  bindScope?(scope: PolicyScopedDatabase, context: TaskActorContext): TasksApi
}
```

Semantics: `start` validates the name and input against the definition, serializes the input,
stores a plan snapshot of each step's kind and name, inserts the running row and wakes the tick; a
definition edited mid-run is detected against that snapshot (`workflow_definition_changed`). The
tick advances one row per compare-and-set: `waiting` resumes on the task's decision (`approve`
continues, `reject` fails with `workflow_task_rejected` or jumps forward to `onReject.step`),
`running` with a step job waits for it and validates its output (`workflow_step_failed`,
`workflow_invalid_output`), and a running row with no job dispatches the current step. `cancel`
stops the in-flight job and pending task, then settles the row. A decided or expired task never
reopens; `failed`/`succeeded`/`cancelled` are terminal. Approval assignment is stored as
`assignedPermission` and filtered by `ctx.tasks.list`; enforcement is in the app route because
permissions live in the session. A workflow declares no `dbTables`: its table surface is derived
from the `dbTables` of the jobs its steps reference (approval steps contribute nothing,
D-162/§8.4.6). Both tables are tenant-scoped, RLS-policied framework tables
(`facilis_workflows`, `facilis_tasks`), DDL-owned by a migration like `facilis_jobs`. Error
codes: `workflow_unknown`, `workflow_invalid_input`, `workflow_invalid_output`,
`workflow_unavailable`, `workflow_definition_changed`, `workflow_step_failed`,
`workflow_task_rejected`, `workflow_task_expired`, `workflow_task_cancelled`,
`workflow_interrupted`; tasks: `task_not_found`, `task_already_decided`, `task_expired`,
`task_invalid_input`, `task_unavailable`.

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

### 8.3 RLS Declaration and Rendering

RLS is **declared in `db/schema.ts`** with `.enableRLS()` and a `@facilis.dev/db` policy helper
(`rlsForTable`, or `tenantIsolationPolicy`/`ownerIsolationPolicy`/`rolePolicy`). The release
generator renders the declared policies into the artifact; there is no migration plugin and no
implicit DDL (D-158). `config.db.tenantColumns`/`ownerColumns` are the columns the analyzer treats
as a table's scoping columns, and the schema ships the matching policy in the same patch (rule 10):

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING (<scope_column> = current_setting('app.<scope_column>')::uuid);
```

Declare the tenant column with `tenantColumn()` from `@facilis.dev/db`: it is the same `uuid`, with
the `DEFAULT` that reads the policy-scope GUC, so inserts never name the tenant (D-040).

### 8.4 Role Definition & Assignment

Three phases, three actors.

#### 8.4.1 Phase 1 — Definition (developer, code, committed)

Roles and permissions are **declared in `facilis.config.ts`**. They are code: reviewable, diffable, versionable.

```typescript
// facilis.config.ts
import { defineConfig } from "@facilis.dev/core"

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
- Roles and permissions are **stable identifiers** — renaming a role requires a seed update, rendered at release time (see §8.4.2).

#### 8.4.2 Phase 2 — Bootstrap (framework, release artifact, one-time)

`@facilis.dev/auth` declares the tables; the release generator renders their DDL from the declared
schema **and** the role seed from the config into the tag's artifact. In order, it carries:

```sql
-- Rendered from db/schema.ts + facilis.config.ts

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

**Key invariant:** `role_permissions` is a **projection** of `facilis.config.ts`. It is written **only** by the deploy's seed post-step (D-159).

**Deploy.** `facilis db deploy --release <tag> --backup-ref <ref>` applies the pending artifacts in
tag order through the `_facilis_deploy_runs` ledger: preflight `digest(live) == fromDigest`, one
transaction per artifact, approval and `backup_ref` for destructive ones, then the post-steps
(seed, `ensureAppRole`, `ensureSystemRole`, views). `facilis db status` reports the ledger state;
`facilis db adopt`/`repair` are the explicit one-time legacy/drift operations. drizzle-kit is not
a deploy step (D-159).

#### 8.4.3 Phase 3 — Assignment (admin, runtime, data)

**Bootstrap of the first admin** — via env vars: the email names the account, the token is the
credential. Both are required (D-150):

```bash
# .env (never committed)
FACILIS_INITIAL_ADMIN=founder@azienda.it
FACILIS_INITIAL_ADMIN_TOKEN=<one-time secret, e.g. openssl rand -base64 32>
```

`@facilis.dev/auth` promotes only when ALL of these hold: `FACILIS_INITIAL_ADMIN` is set, a
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
joining a request, records `system:job:<name>`, and guards the elevated client with the job's
required `dbTables` (possibly `[]`, D-162), whether `db.execute` is allowed by `rawSql`, and the
observed relations; `ctx.sudo` and `ctx.system` keep requiring a non-empty subset of the route's
`dbTables`. The
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
import { tenantColumn } from "@facilis.dev/db"

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
| **System-only** | off | no table privilege at all | the privileged owner connection and `facilis_system` (`ctx.sudo`/`ctx.system`/`runAsSystem`): boot, the deploy, the dev console |

RLS is the grant boundary, not optional hardening. A table without RLS is **not** open to everyone
and **not** denied to everyone — it is unreachable for the request identity, and that is exactly
what makes it system-only.

**Enforcement.** `ensureAppRole(db)` runs as a deploy post-step after the artifacts are applied
(and at dev boot after the PGlite reconcile, [POSTGRES.md](./POSTGRES.md) §4) and reconciles
privileges with the live catalog: it first clears
every table-class privilege (so an older cluster's blanket grant cannot survive on partition
children, materialized or foreign tables), then re-grants only the RLS tables — the catalog's
`pg_class.relrowsecurity` decides, so a table keeps DML only while RLS is enabled and every other
table is `REVOKE`d from `facilis_app` and `PUBLIC`. No table default privilege is installed, so a
table an artifact creates stays closed until its RLS is on and the function runs again — the first
query fails closed with `permission denied`. Sequences remain granted (USAGE cannot read or write a
table), and the role is `NOINHERIT`: it is a member of `facilis_system` only so a deployment whose
connection already is `facilis_app` can `SET ROLE` for the audited elevation, and inheriting that
membership's grants would reopen every system-only table.

**Route declarations (D-157).** The route-level counterpart is `dbTables`: a route declares every table or
view it reaches through `ctx.db`/`ctx.sudo`/`ctx.system`, the analyzer/validator check the declaration
against the code, and the runtime guard refuses an undeclared relation before the query (fail-closed). A
system-only table is still reachable only through the audited elevation, and the elevation's own `tables`
are checked against what the callback observed.

**Job declarations (D-162).** Jobs extend the same declaration to the system client their `run(ctx)`
receives: `defineJob` requires `dbTables` (tables and views by SQL name, `[]` = no relation) and
accepts `rawSql: true` for `db.execute`. `runAsSystem` wraps the elevated transaction in the same
`guardDatabase`, so an undeclared relation fails closed with `table_not_declared` and raw SQL
without the flag with `raw_sql_not_allowed`. A violation is terminal (the attempt is not retried) and
the job error stores the canonical code; the audit entries record the declared set and, on
`succeeded`, the observed relations (`observedTables`). The analyzer's job pass follows
project-local helper calls in the `run` body and reports `job-definition`/`job-definition-static`
(warnings), `job-table-undeclared`/`job-table-unresolved`/`job-raw-sql` (errors) and
`job-table-unused` (warning); `jobs-gate.test.ts` runs it over `examples/` (D-154 pattern) and
validator rule 19 `job-table-declared` covers patches. A workflow declares no tables: its surface is
derived from the `dbTables` of the jobs its job steps reference (approval steps contribute
nothing); a referenced job with no definition is a `workflow-job-unknown` warning and an
unreadable job declaration makes the derived surface explicitly unknown (§7.10). Jobs are
deliberately not project-graph nodes yet.

**Framework tables.** `users`, `sessions`, `user_roles`, `auth_identities`, `auth_sso_states`,
`api_clients`, `api_tokens`, `facilis_files`, `facilis_jobs` and the generated link tables are
app-scoped. `sessions`, `user_roles`, `api_clients` and `api_tokens` have no tenant column of
their own: their policy is an `EXISTS` over `users` (the D-053 inheritance pattern), so they are
visible exactly when their parent user is — for an API client, its `users.is_service` service
account (D-142). `roles` and
`role_permissions` are system-only: the deploy seed writes them, and permissions reach the app
from `facilis.config.ts` through `expandRoles`, never from the table.

**Graph, analyzer and drift.** The project graph labels a table without RLS **system-only**, in a
neutral colour — it is a class, not a warning — and the Data Explorer's live badge uses the same
label. It does not announce RLS on app-scoped tables — RLS is the default class — so only the
system-only exception is named (D-174). The analyzer warns `route-system-table` when a route
declares a system-only table in
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
- AI patches are **validated** before write (19 rules, §9.3)
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
- `role_permissions` is written **only** by the deploy's seed post-step (D-159)
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
server-only error entry; `@facilis.dev/nitro`'s logging suite pins env resolution, stream routing,
redaction/caps, level filtering, rotation, chain verification (good/tampered), fail-closed audit,
the request-id middleware and the bootstrap/sudo bridge; the IDE suite pins the log parser and
filters. `docs/LOGS.md` is the operator contract.

---

## 9. AI Orchestration

### 9.1 Chat Architecture

The chat runs on the **PTC tool runtime**: the model writes one JavaScript program per step against
a read-only tool registry (D-101/D-103; design in [`PTC.md`](./PTC.md)), and patches remain the
only source-write path. The older Model A (preloaded context, one-shot) and Model B (per-call
tool loop) split is retired design history; the preloaded context (file list, config, manifest,
`AGENTS.md`) survives as context, not as a chat mode.

### 9.2 System Prompt (Shared Core)

Rules the AI must obey:

1. Every route uses `defineAuthorizedHandler`
2. `dbTables` and `permission` required
3. Zod schemas for any used input
4. All scoped tables get RLS policies in the same patch
5. Use the existing components and layouts; do not create new primitives unprompted
6. All strings via `t("key")`
7. Minimal patches; match existing style
8. Output is a single `AIResponse` JSON object; no prose outside. A set too large for one answer is sent in parts with `"continue": true` (D-106; no part quota, D-108)
9. **Do not invent permissions or roles.** If a route needs a permission not declared in `facilis.config.ts`, add it to `config.auth.permissions` in the same patch and note it in `notes`. Same for new roles.
10. **Every route carries a description:** one English sentence, max 120 characters (about two lines), saying what the route does and what it touches; keep it current when the route's contract (permission, inputs, `dbTables`/`dbColumns`) changes. It is source documentation shown in the graph and OpenAPI, never a `t()` key (D-129).

### 9.3 Patch Validator (19 Rules)

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
| 9 | `no-raw-db-access` | error | No raw Drizzle client imports outside `@facilis.dev/db` |
| 10 | `rls-on-scoped-table` | error | Every scoped table in the resulting `db/schema.ts` ships with `enableRLS` + a policy helper |
| 11 | `file-path-allowed` | error | `managed` (default): `server/`, `src/`, `db/`, `lib/`, `components/`, `locales/` plus `facilis.config.ts`; AI patches never get the IDE writer's explicit `rootFiles`. `open`: any project-relative path except `node_modules`/`.git`/`.facilis`/`dist`/`.turbo`/`coverage` segments, `package.json`/lockfiles/`.npmrc` and `AGENTS.md` (D-167) |
| 12 | `import-resolves` | error | All imports resolve (relative or in `node_modules`) |
| 13 | `i18n-keys-registered` | warning | All `t("key")` calls have keys in `locales/en.json` |
| 14 | `migration-generated` | error | No authored `.sql`: DDL is generated into the release artifact (D-158); the schema must stay renderable |
| 15 | `destructive-confirmed` | error | Destructive schema → `requires_confirmation: true` |
| 16 | `role-config-sync` | error | If patch modifies `facilis.config.ts` roles/permissions, the schema must stay renderable and consistent: the seed is generated at release, never authored |
| 17 | `route-description` | warning | Every patched, valid route has a one-sentence English `description` (≤120 chars ≈ two lines), refreshed when its contract (permissions, inputs, `dbTables`/`dbColumns`) changed |
| 18 | `route-table-declared` | error | Every relation used through `ctx.db`/`ctx.sudo`/`ctx.system` (following project-local helper calls) is declared in `dbTables` — tables and views; a dynamic/unresolvable relation and `db.execute` without `rawSql: true` are errors; a declared-but-unused relation is a warning (D-157) |
| 19 | `job-table-declared` | error | Every relation used through a job's system-scoped `db` (following project-local helper calls) is declared in the definition's `dbTables` — tables and views; a dynamic/unresolvable relation, `db.execute` without `rawSql: true` and an unreadable declaration are errors; a declared-but-unused relation is a warning. Covers all effective jobs, not only patched ones (D-157/D-162) |

**Status (2026-11-04): implemented over AST facts** in `@facilis.dev/ai` (D-084, D-092/D-093).
The main entry stays browser-safe: `validatePatch(patches, { context, requiresConfirmation,
allowedRootFiles, writePolicy })` is synchronous and takes a typed `PatchContext` whose facts are
the effective (post-patch) `Analysis` from `@facilis.dev/analyze` plus the pre-patch one for
inverse edits. The caller supplies them — the IDE analyzes the VFS snapshot and the patch overlay
with its one warm browser worker, caching the pre-patch analysis; Node tooling uses the
`@facilis.dev/ai/node` helper. `writePolicy` defaults to `managed` (D-167): the six roots plus
`facilis.config.ts`, with `allowedRootFiles` only for the IDE's own writers, so a managed build
never accepts a `.github/workflows` file. An `open` build passes `open` and may write any
project-relative path except the deny list in the rule 11 row — install surface, VCS/IDE/build
state and `AGENTS.md` — so root config and `.github/**` are writable. Sources are read only for `package.json` (installed packages) and
`tsconfig.json` (path aliases); the manifest's `blocks` section is reserved and always empty now
that no block package ships (D-131). Rule 1 parses through an injected `SyntaxChecker` — the analyzer worker's oxc
parser in the IDE (D-105), the `@facilis.dev/ai/node` subpath (rolldown/oxc) outside it — and fails
closed when no checker answers. If the analyzer itself is unavailable the IDE fails the round
closed with a `project-analysis` error and never applies the patch. A parser/analyzer outage is
an `infrastructure` finding: the chat reports a validator outage and does not spend a repair
round asking the model to fix it (D-105). Rules 5, 13 and 17 are warnings, and rule 19 adds a declared-but-unused warning; every
other finding blocks the apply. The IDE validates at proposal time, re-validates the accepted files at Apply
time and `applyPatch()` re-validates before the first VFS write. Facts are AST-derived now:
wrapper/body-read/`dbTables` cannot be spoofed by comments or strings, `dbColumns` uses Drizzle
property names, imports cover static/re-export/dynamic/`require` and rules 10/15 ignore
framework re-exported tables. Declared limits: i18n covers static `t()` keys and the effective
default catalogue, authored-DDL detection is a `.sql` change in the patch, destructive detection
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
- **The loop lives in the IDE**, not in `@facilis.dev/ai` (D-100): the validator stays a pure
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

### 9.5 Model B Tool Surface

**Status (2026-11-07): the PTC design (D-101/D-103) is the tool runtime.** The model writes
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
written directly and is not source. D-171 adds the graph-view tools (`graph_highlight`/
`graph_paths`/`graph_screenshot`): they act on the visible graph (ids validated against the
panel's view, focus requests replay to the next mount), search it undirected and render it
off-DOM onto the D-112 image channel; they never write project state. D-139 adds the git family (`git_status`/`diff`/`log`/
`branches`/`remote`/`stage`/`unstage`/`commit`/`branch`/`sync`/`pull_request`):
repository index/history/ref/remote operations through Source Control's own sessions, never source
edits, with the tab-memory GitHub token as the only credential, dirty-tree refusals for switch/pull
and no destructive operation. D-138 makes the transcript itself chronological: a turn's activity is
persisted on its user message (success, failure or cancel) and rendered between the question and
the answer, so the executions precede the prose in every state.

**D-175 adds the host-side web family** (`web_fetch`/`web_image`/`web_download`): a program asks
the host for a URL and the host, not the sandbox, performs the request. Reach is the deployment
profile — `open` allows any HTTPS host, `managed` only the origins in `network.connect` (the same
list compiled into `connect-src`), and a managed build with an empty list advertises no web
tools, so the default is still no egress. Requests are GET with credentials omitted and no
caller-supplied headers or body, the URL a redirect lands on is re-checked, text is capped at
32k chars and secret-redacted, images at 5 MB (two per program), downloads at 5 MB (five per
program), and a program may make 10 calls / 8 MB in total. A download may only write a
project-relative path under `public/` — a static asset, never source — so the patch path and
invariant 9 are unchanged.
The browser's CORS rule is a real limit: a host that does not send `Access-Control-Allow-Origin`
cannot be read. Fetched content is untrusted data — a prompt-injection vector — so the model
must never follow instructions found in a page.

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
| Project graph | `ProjectGraphPanel.tsx` + `project-graph` editor tab | One graph from `@facilis.dev/analyze` (D-092): pages → routes → tables → views (D-160) and workflow definitions (D-161) plus FK/`relations()` edges, route→view `dbTables` edges and view→base-table edges; route cards carry the wrapper config's one-sentence description (D-129); fullscreen, edge filters, drag; committable, merge-friendly layout + markdown notes in `.facilis/graph/` (D-126); per-node details inspector joined from the analysis (security flags, db columns, policies, foreign keys, static db usage, source lines), line-anchored source snippets and the schematic page mini-page drawn on page cards and in the inspector (D-170, D-176) |
| Commit graph | `CommitGraphPanel.tsx` + `commit-graph` editor tab | React Flow over the local git log: lanes, merge edges, branch/HEAD cards, details inspector (D-088) |
| Diff tab | `EditorPanes.tsx` + `diff-session.ts` | Every SCM change opens a side-by-side HEAD ↔ working-tree diff, first hunk revealed (D-089) |
| Entity Explorer | `DataExplorerPanel.tsx` + activity view + `data-query` tab | Live code ↔ DB diff and a read-only SQL console with Create-view (optional declared view permission, D-098), through a kernel-mediated same-origin dev proxy (D-097); declared tables from `@facilis.dev/analyze` still planned (O-011) |
| Release Preview | `ReleasePreviewPanel.tsx` + activity view | `buildReleasePreview(from, to)` (D-086) |
| Project Switcher | Extend `Home.tsx` | Uses `ProjectRegistry` + git auth |
| GitHub sign-in | Git dialogs + `GitHubSignIn.tsx` | OAuth device flow, token in tab memory (D-082) |
| Stored credentials | Extend git modal | WebCrypto storage in OPFS (planned, other hosts) |
| `applyPatch()` | `IdeController` method | Writes through `kernel.writeFiles` |

**Status (2026-11-11):** the additions above are implemented and verified by the IDE suites plus
`pnpm ide:smoke`. The chat and the §9.4 repair loop run on the PTC tool runtime (the only mode,
D-101/D-103); the 19-rule validator is applied at proposal, Apply and the first VFS write
(D-084/D-100); the project graph is built from `@facilis.dev/analyze` facts — pages, explicit page
links, audited elevation, framework tables, declarative views with `route-view`/`view-base` edges
(D-160) and, since D-161, workflow definitions with their job/approval steps — with a committable,
merge-friendly layout under `.facilis/graph/` (D-126/D-134/D-160); Source Control opens per-change
diffs and the commit graph (D-088/D-089). There is no Studio tasks inbox tab: the inbox/decide
routes are app-owned and the graph is the only workflow surface the IDE adds (D-161). Open: the
eval corpus/browser matrix (§9) and the declared-AST half of the Entity Explorer (O-011).

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

### 10.5 Multi-Project Tabs

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
- **Diffs them** through a pure function: typed drift like *"code says X, DB says Y — reconcile (dev) or run the release deploy / adopt / repair"*
- RLS status badges: 🟢 policy defined / 🟡 RLS on, no policy / 🔴 RLS off on scoped table / ⚪ system-only (RLS off, unscoped)
- Reverse lookup: "used by these routes" (from `x-db-tables`/`x-db-columns`)
- Click to jump to `db/schema.ts` or the route file in Monaco

**Status (2026-11-06): implemented, kernel-mediated connection** (D-083, D-097, O-011).
`@facilis.dev/db` exposes `liveSchemaSnapshot` and `diffSchemaSnapshots`; `GET /__facilis/dev/schema`
is the dev-only transport (404 in production, origin-allowlisted) and the Studio renders it in
the `data` activity view, next to the query console (§11.2). The panel builds every request from
a same-origin `/preview/<port>/…` URL carrying the kernel token, which the Studio's Service
Worker routes to the in-VM dev server; a popped-out preview therefore works, and no embedded
iframe is required. The SW persists its per-frame routing in the `vv-config` cache (D-132), so a
preview reload after an idle worker eviction still reaches the tab that served it. Remaining: the
declared half can come from `@facilis.dev/analyze` immediately (a project that is not running), and
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
  `defineView({ name, columns, query, permission? })` from `@facilis.dev/db` (§5.2), written through
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
  bypass RLS — `@facilis.dev/db` proves both the leak and the invoker guarantee.
- **Route declaration (D-157).** A route that reads a view declares the view's **name** in `dbTables`, not its
  base tables: the view is the relation the handler touches, and for a definer view the declared `permission`
  (not the base RLS) is the gate. `@facilis.dev/analyze` parses `defineView` into `ViewFact`s (name, base tables,
  permission, access), so the validator accepts the view name and the usage pass resolves it; the runtime
  guard compares the Drizzle view object's name with the declaration. Base tables stay in the view's own
  metadata, never in the route declaration.
- **Project graph (D-160).** Each view is a `view:<name>` node carrying its invoker/definer mode,
  permission and declared base tables; a route that declares the view in `dbTables` gets a
  `route-view` edge (elevated inside an audited `ctx.sudo`/`ctx.system`) and the declared base tables
  get `view-base` edges, so "which route uses which view" is visible in the graph. The declaration,
  not the observed AST use, is the source: D-157 makes it verified and enforced at runtime.
- **Provisioning**: dev boot re-applies `db/views/**` after the PGlite reconcile (a broken view
  becomes a manifest warning, never a failed boot). A Postgres deployment provisions views as a
  deploy post-step after the artifacts are applied, and boot reports `view_ddl_skipped`.
- Results are never persisted and never enter LLM prompts.

### 11.3 Release Preview (Phase 3.5)

Four diff lenses, one engine:

| Lens | Compares | Answers |
|---|---|---|
| Tag ↔ HEAD | generated `planSchema` snapshots from the git tree | The SQL and risk that ship in the next release, no DB (D-158/D-159) |
| Working copy ↔ HEAD | OPFS vs last commit | What am I about to commit? |
| HEAD ↔ origin/main | Local vs remote | What ships on next deploy? |
| origin/main ↔ Tag | Remote vs release ref | What changed since last release? |
| Code ↔ Live DB | `db/schema.ts` vs live catalog | In sync? (dev-only engine: `diffSchemaSnapshots`, D-083) |

**Risk classification per statement:**

- 🟢 Safe: add nullable column, add table, add index, add policy
- 🟡 Careful: non-null without default, add UNIQUE, rename
- 🟠 Destructive: drop column/table, narrow type, tighten RLS
- 🔴 Breaking: drops referenced by routes (cross-checked with `x-db-columns`)

**Status (2026-11-05; amended to the generated-plan model 2026-11-10, D-158/D-159).** The schema
lens computes the **tag → HEAD generated plan** with the same pure `planSchema` renderer the
release pipeline runs: it reads `db/schema.ts` and `facilis.config.ts` out of the git tree
(isomorphic-git, no boot, O-008 resolved) and shows the SQL batches plus their risk. The plan uses
**no database access** and **fails closed** where the analyzer cannot resolve a declaration; the CI
artifact for the tag is authoritative, so the preview never presents SQL that will not ship (the
D-086 "never synthesize SQL" premise is superseded). Authored migration files are no longer part of
the project or a lens; the declared schema comes from `@facilis.dev/analyze` facts over the ref sources
(columns as Drizzle property names, policies and RLS flags from the DSL), so a route derived at an
old ref knows method+path only.

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

Phases 0–4 are implemented, Phase 5 was retired, Phase 6 is in progress and Phase 7+ is the
post-MVP backlog; the open-items table in [`DECISIONS.md`](./DECISIONS.md) lists the still-open items
and [`STATUS.md`](./STATUS.md) is the current-state summary.

| Phase | Goal | Status |
|---|---|---|
| 0 | Feasibility spike (Vivari + Vite/Nitro + PGlite + RLS) | ✅ done; the browser half is scripted in `pnpm ide:smoke` |
| 1 | Core packages (`core`, `db`, `auth`, `nitro`) | ✅ done; `examples/todo-app` is the acceptance app |
| 2 | Studio extension (chat shell, git round-trip, tabs) | ✅ shipped at <https://ide.facilis.dev> (D-077) |
| 3 | Visualizers (project graph, Entity Explorer, Release Preview) | ✅ done (D-083/D-086/D-092); the API Flow is retired (D-095) |
| 4 | AI orchestration + validator + repair loop | ✅ done (D-084/D-100/D-101/D-103); eval corpus and browser matrix open |
| 5 | Headless blocks + i18n + RoleAssignment | ⛔ retired (D-131); no block supply chain ships |
| 6 | Polish + MVP demo | 🟡 template, deployment and demo script done; human rehearsal and the how-to pages open |
| 7+ | Post-MVP backlog | see the open-items table in [`DECISIONS.md`](./DECISIONS.md) |

Acceptance criteria are in §14.

---

## 13. Risks & Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **PGlite RLS incomplete** | Kills "unbypassable" guarantee | Phase 0 spike; fallback to `drizzle-policy` only |
| 2 | **Nitro v3 churn** | Build breaks between upgrades | Pin exact version; upgrade deliberately with spike tests |
| 3 | **`defineRouteMeta` in wrapper not scanned** — **confirmed in Phase 0** | No `x-db-tables` in OpenAPI | Framework-owned static pass + OpenAPI facade is **required**; prototype verified in Phase 0, replaced on 2026-11-04 by `@facilis.dev/analyze` facts with a parser injected from `rolldown/utils` (`packages/nitro/src/route-metadata.ts`, §6.9). Any project source edit invalidates the virtual module. |
| 4 | **OpenAPI incomplete** | AI generates wrong code | Augment with `/__facilis/manifest` |
| 5 | **Vivari memory/CPU limits** | Slow or crashes at ~50 routes | Lazy-load PGlite; measure; document limits |
| 6 | **AI hallucinates unguarded routes** | Security regression | Patch validator rejects before write |
| 7 | **COOP/COEP hosting** | Can't deploy Studio anywhere | Cloudflare/Netlify/Vercel recipes; `coi-serviceworker` fallback |
| 8 | **x-db-tables drift** | Visualizer draws wrong edges | Lint rule: handler imports `db` but no `x-db-tables` → CI fail |
| 9 | **Vivari OPFS write-behind lag** | Uncommitted work lost on crash | Call `vivari.fs.flush()` on `visibilitychange` |
| 10 | **AI over-fetches (Model B)** | Token cost explodes | Preload summary always; prompt: "aim ≤10k input tokens" |
| 11 | **Role drift between config and DB** | Security hole | `role_permissions` written only by the deploy seed; validator rule 16 |
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
- RLS policies declared with helpers and rendered into the artifact for scoped tables
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
- Workflows: a `server/workflows/**` chain of a job and an approval step runs through the tick,
  the approval task is decided through an app-owned authorized route, and the chain continues (or
  fails on rejection); a declared `onReject` step is reached instead of failing; the example app
  ships a purge workflow with a start route (D-135)
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
- One project per tab; opening the same project in a second tab is refused (D-033)
- Release preview shows correct risk classification for a schema drop
- Uncommitted-change reminder fires within 5s of any write
- A new `manager` role added via config + release artifact works end-to-end in < 30s

---

## 15. Open Questions

Resolved and open questions are tracked in the "Open" table of
[`DECISIONS.md`](./DECISIONS.md) (O-001…O-020); the spec no longer keeps a second copy.

---

## Appendix B — `facilis.config.ts` Reference

```typescript
import { defineConfig } from "@facilis.dev/core"

export default defineConfig({
  release: {
    ref: "origin/main",
  },
  db: {
    mode: "pglite",
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
  // Workflows (D-135, optional): a chain of job and approval steps advanced by a tick.
  workflows: {
    tickIntervalMs: 1000,  // runner tick, minimum 100
    persist: true,         // keep runs in facilis_workflows (needs a migrated table)
    defaultTaskTtlMs: null, // null = approvals do not expire unless a step sets ttlMs
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
import { defineAuthorizedHandler } from "@facilis.dev/core"
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

**Nitro v3 has no auto-imports.** Route files must import every helper explicitly (`defineHandler`, `defineRouteMeta`, `HTTPError`, … from `"nitro"`). `defineAuthorizedHandler` is imported from `@facilis.dev/core` and re-exports the types route authors need.

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
export * from "@facilis.dev/auth/db"
export * from "./todos"
export * from "./documents"
```

### Step 3 — Generate and apply the release artifact

There is no migration file to write. Commit `db/schema.ts` and `facilis.config.ts`, tag the release,
and let the release pipeline generate the artifact from the previous tag and this one (D-158); the
deploy applies it (D-159):

```bash
facilis db deploy --release v1.0.0
```

The artifact carries `CREATE TABLE roles`, `CREATE TABLE role_permissions`, `CREATE TABLE user_roles`, the RLS wiring (D-136: `sessions`/`user_roles` are app-scoped with an `EXISTS` policy over `users`; `roles`/`role_permissions` stay system-only), **and** the seed from your config: the DDL and the seed are rendered by the framework, never authored by a person or the AI.

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

**Assign additional roles:** via `POST /api/users/:id/roles` (permission `users:manage`).

---

## Appendix E — Vite + Nitro Quick Reference

### `vite.config.ts`

```typescript
import { defineConfig } from "vite"
import { facilis } from "@facilis.dev/nitro/vite"
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
