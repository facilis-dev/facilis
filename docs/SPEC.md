# 📘 Facilis — Full Specification

**Version:** 1.13 (background jobs + permission views + audited sudo, D-098/D-099/D-107)
**Status:** Phases 0–3 complete and verified (headless + the browser harness, `pnpm ide:smoke`); the Studio (Phase 2) ships at <https://ide.facilis.dev> (D-077). Phase 4 has the AI chat, the 16-rule validator, the apply path, the §9.4 repair loop and the PTC tool runtime (the chat's only mode, D-103); the eval corpus and browser matrix remain. The live per-phase state is in [`README.md`](../README.md#status).
**Purpose:** Single source of truth for development

**Changelog:**

- v1.13 — Background jobs (D-107): a durable `facilis_jobs` queue with config-driven concurrency, retry, timeout and cancellation; named definitions in `server/jobs/**/*.ts`; the server-only `ctx.jobs` API (enqueue returns an id, schedule at an instant, read the queue/running jobs, cancel); every attempt in a system context through `runAsSystem` with the sudo audit; persisted queue state with at-least-once recovery. There is no workflow construct yet (O-017). §5.1/§5.2/§5.6/§7.1/§7.4/§7.9/§8.4.5/§14.2 follow.
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
│   ├── blocks/               @facilis/blocks
│   │   ├── src/
│   │   │   ├── DataTable/
│   │   │   │   ├── index.tsx
│   │   │   │   └── manifest.ts
│   │   │   ├── ResourceForm/
│   │   │   ├── AuthGuard/
│   │   │   ├── RoleGate/
│   │   │   ├── RoleAssignment/       (Phase 5)
│   │   │   ├── LoginForm/
│   │   │   ├── ConfirmDialog/
│   │   │   ├── FileUpload/
│   │   │   └── ...
│   │   └── package.json
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
│   │   │   ├── validator/            patch validator (16 rules)
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
│       ├── auth/                 register, login, logout, session
│       └── todos/                index.get/post, [id].patch/delete
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
├── .facilis/                     dev-only state, never source: db/snapshot.tar.gz, binary/
├── index.html
├── vite.config.ts                plugins: [tailwindcss(), facilis(), react()]
├── facilis.config.ts             the one config: roles, permissions, nitro options
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
  a restrictive tenant policy
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
  The engine's own queue reads/writes run as `facilis_app` under the deployment tenant; only a job
  *body* runs as `facilis_system` (see the audited-sudo bullet)
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
- `createSession()`, `destroySession()`, `validateSession()`
- `hasPermission(user, permission)` — RBAC check helper
- `expandRoles(roles, roleMap)` — expands roles to permission set (pure function, reads config)
- `db` — re-export of the auth tables (`users`, `sessions`, `roles`, `role_permissions`, `user_roles`)
- `seedFromConfig(config)` — generates the seed migration from `FacilisConfig.auth`
- `registerInitialAdmin()` — reads `FACILIS_INITIAL_ADMIN` env var and grants admin role on registration
- Login/logout/register route blueprints (optional to install)
- Role-assignment API blueprint (`POST /api/users/:id/roles`)

**Auth tables (from `@facilis/auth/db`):**

```typescript
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  tenantId: tenantColumn(), // @facilis/db: uuid NOT NULL DEFAULT app.tenant_id (D-040)
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow(),
})

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
})

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
})
```

**Critical:** the `role_permissions` table is a **projection** of `facilis.config.ts`. It is seeded at migration time and never written at runtime.

### 5.4 `@facilis/blocks`

Each block is an independent module with two files:

```
src/<Block>/
├── index.tsx         React component (Tailwind + shadcn/ui)
└── manifest.ts       BlockManifest export
```

Shipped blocks in MVP:

| Block | Category | Purpose |
|---|---|---|
| `DataTable` | data | TanStack Table, paginated, sortable |
| `ResourceForm` | form | React Hook Form + Zod |
| `AuthGuard` | auth | Redirect to login if no session |
| `RoleGate` | auth | Render children only if role matches |
| `LoginForm` | auth | Email/password login, uses auth API |
| `ConfirmDialog` | feedback | shadcn Dialog wrapper |
| `FileUpload` | media | FormData POST to a resource endpoint |

Shipped in Phase 5:

| Block | Category | Purpose |
|---|---|---|
| `RoleAssignment` | auth | Admin UI to assign roles to a user |

### 5.5 `@facilis/ai`

Exports:

- `buildPrompt(manifest, mode)` — system prompt (A or B variant)
- `assembleContext(vivari, manifest, openFiles, diff, mode)` — preload builder
- `parseResponse(raw)` — AIResponse parser
- `buildProjectContext(input)` — projects an `Analysis` (+ optional pre-patch one) into the
  typed validator context; the caller supplies the facts (the IDE from the analyzer worker)
- `validatePatch(patches, { context, requiresConfirmation, allowedRootFiles })` — 16-rule
  validator over analyzer facts (D-092); the main entry stays browser-safe and the only
  parser is the injected syntax checker
- `applyPatch(controller, patch)` — writes through `kernel.writeFiles`

### 5.6 `@facilis/nitro` — Vite plugin + Nitro module

This package has **three entry points**: the Vite plugin (which also mounts Nitro), the Nitro module it carries, and the route-facing session-cookie helpers.

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

**Why separate entry points?** Vite plugins can extend Nitro programmatically by exposing a `nitro` key (a Nitro module) on the plugin object, and Nitro's own plugin mounts by returning `Plugin[]`. `facilis()` is both: it returns the Facilis plugin carrying the module, followed by `nitro()`'s plugins. The user writes one plugin in `vite.config.ts` and gets Nitro plus all `__facilis` routes, virtual modules, and collectors. The session helpers are their own entry point because they import h3 while core's route contract does not (contracts §4.1): the single `FacilisRequestEvent` → `H3Event` narrowing lives there, and a handler stays free of h3 imports.

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

Content-addressed binary storage for files uploaded by a generated app (D-053). Bytes are
addressed by their sha-256 hex digest and never stored in Postgres; a `facilis_files` row is
the metadata.

| Concern | Decision |
|---|---|
| dev | `<project>/.facilis/binary/<hh>/<hash>` — project filesystem, so the VFS/OPFS mirror persists it; the directory is self-ignored for git |
| prod | S3-compatible bucket, key `blobs/<hash>` (AWS S3, Cloudflare R2, MinIO; one SigV4 driver, no SDK) |
| drivers | `createLocalStorage({ rootDir })`, `createS3Storage({ bucket, region, endpoint?, ... })`; `put` is idempotent per content hash |
| access | a proxy route `GET /api/files/:id?token=…` verifies a short-lived HMAC token and streams the blob (dev) or redirects to a presigned S3 GET (prod). GET is token-only; mutations stay session-authenticated |
| metadata | `facilis_files` + generated `fileLinks(parent, …)` tables (§5.2) |
| cleanup | no GC yet: bodies are immutable and deduplicated, so orphans cost space only for content no longer referenced |

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
AI validator, and the Nitro manifest/OpenAPI facts.

## 6. The `/__facilis/manifest` Endpoint

### 6.1 Transport

| Property | Value |
|---|---|
| Method | `GET` |
| Path | `/__facilis/manifest` |
| Availability | `NODE_ENV !== "production"` (else 404) |
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
| 404 | `NODE_ENV === "production"` |
| 503 | Facilis module failed to start |

**Partial failure is 200, not 500.** A broken `db/schema.ts` emits a warning and omits the `schema` section.

### 6.5 Revision Hashing

`revision` = SHA-1 of concatenated hashes of:

- `facilis.config.ts` content
- Sorted list of `db/schema.ts` and its imports
- Generated OpenAPI spec JSON
- Sorted `node_modules/*/manifest.*` for block packages
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

- Dev-only guard: `NODE_ENV === "production"` → 404
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
  blocks: { packages: string[] }
  nitro: Record<string, unknown>     // pass-through Nitro options; framework defaults underneath (D-034)
  auth: {
    permissions: string[]
    roles: Record<string, string[]>      // role name → permission list; "*" is wildcard
    defaultRole: string                  // assigned on registration
    sessionDurationMs: number
  }
  jobs: {
    maxConcurrent: number      // attempts executing at the same time (default 2)
    maxAttempts: number        // total attempts per job; 1 = no retry (default 1)
    retryDelayMs: number       // fixed delay before a retry (default 5000)
    timeoutMs: number          // wall-clock bound of one attempt (default 30000)
    pollIntervalMs: number     // scheduler tick, minimum 100 (default 1000)
    persist: boolean           // keep the queue in facilis_jobs (default true)
  }
}
```

### 7.2 `BlockManifest`

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
  blocks: BlockManifest[]
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
  description?: string                        // from the wrapper config (AST pass)
  permission?: string | string[]              // string[] mirrors the handler config
  dbTables: string[]                          // empty = explicit "no DB"
  dbColumns: string[]                         // format: "table.column"
  security: "required" | "optional" | "public" | "unknown"
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
interface AuthorizedHandlerConfig<Body = void, Query = void, Params = void> {
  permission: string | string[]               // [] for public routes
  body?: ZodSchema<Body>
  query?: ZodSchema<Query>
  params?: ZodSchema<Params>
  dbTables: string[]                          // REQUIRED
  dbColumns?: string[]
  description?: string
}

interface AuthorizedHandlerContext<Body, Query, Params> {
  auth: AuthContext                           // guaranteed non-null
  body: Body
  query: Query
  params: Params
  db: PolicyScopedDatabase                    // pre-scoped, never raw
  sudo: SudoHandler                           // audited elevation, §8.4.5; requires a session
  system: SystemHandler                       // audited elevation for public/bootstrap routes
  jobs: JobsApi                               // server-only job queue (D-107), no HTTP surface
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

**Bootstrap of the first admin** — via env var:

```bash
# .env (never committed)
FACILIS_INITIAL_ADMIN=founder@azienda.it
```

`@facilis/auth`'s registration handler checks:

```typescript
async function onRegister(email: string) {
  const user = await createUser(email)
  if (email === process.env.FACILIS_INITIAL_ADMIN) {
    await assignRole(user.id, "admin", null)
  } else {
    await assignRole(user.id, config.auth.defaultRole, null)
  }
  return user
}
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
1. Session middleware reads session cookie
   → loads user from `users`
   → loads assigned roles from `user_roles`

2. expandRoles(roles, config.auth.roles) → permission set
   (pure function, reads config — no DB query)

3. event.context.user = { userId, roles, perms }   // no tenant: it is the deployment's

4. defineAuthorizedHandler checks `permission` against perms
   → 403 if missing, before handler runs

5. policyContext.run({ tenantId: deploymentTenant, userId, roles }, ...)
   → SET LOCAL app.user_id    = '<uuid>'
   → SET LOCAL app.tenant_id  = '<uuid>'
   → SET LOCAL app.roles      = '["manager"]'
   → SET LOCAL app.permissions = '["todos:read"]'   // permission views (D-098)

6. Handler runs. RLS evaluates policies on every query.
```

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

### 8.5 Dev-Endpoint Guards

| Endpoint | Guard |
|---|---|
| `/__facilis/manifest` | 404 in prod, origin allowlist |
| `/__facilis/dev/schema` | 404 in prod |
| `/__facilis/dev/query` | 404 in prod, read-only SQL prefix check |
| `/__facilis/dev/view` | 404 in prod, view name/read-only validation, view permission must exist in `facilis.config.ts` |
| `/__facilis/health` | 404 in prod |

### 8.6 Application-Level Security Rules

- AI patches are **validated** before write (16 rules, §9.3)
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

### 9.3 Patch Validator (16 Rules)

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

**Status (2026-11-04): implemented over AST facts** in `@facilis/ai` (D-084, D-092/D-093).
The main entry stays browser-safe: `validatePatch(patches, { context, requiresConfirmation,
allowedRootFiles })` is synchronous and takes a typed `PatchContext` whose facts are the
effective (post-patch) `Analysis` from `@facilis/analyze` plus the pre-patch one for inverse
edits. The caller supplies them — the IDE analyzes the VFS snapshot and the patch overlay with
its one warm browser worker, caching the pre-patch analysis; Node tooling uses the
`@facilis/ai/node` helper. Sources are read only for `package.json` (installed packages) and
`tsconfig.json` (path aliases); blocks still come from the live manifest because registration is
runtime state. Rule 1 parses through an injected `SyntaxChecker` — the analyzer worker's oxc
parser in the IDE (D-105), the `@facilis/ai/node` subpath (rolldown/oxc) outside it — and fails
closed when no checker answers. If the analyzer itself is unavailable the IDE fails the round
closed with a `project-analysis` error and never applies the patch. A parser/analyzer outage is
an `infrastructure` finding: the chat reports a validator outage and does not spend a repair
round asking the model to fix it (D-105). Rules 5, 13 and 14 are warnings; the rest
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
read-only tool registry (VFS reads, analyzer facts, manifest; MCP servers and skill-scoped
capabilities are the extension seam) and returns lossless JSON. Patches are still the only write
path, validated by §9.3. Design and phases: [`PTC.md`](./PTC.md) — accepted as D-101; the
phase-0 sandbox spike passed (`spikes/ptc-sandbox`, 21/21), the phase-1 chain and trace UI
landed, and the runtime is the chat's only mode (D-103); the eval corpus and the browser matrix
remain.

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
| Project graph | `ProjectGraphPanel.tsx` + `project-graph` editor tab | One graph from `@facilis/analyze` (D-092): pages → routes → tables plus FK/`relations()` edges; fullscreen, edge filters, drag; layout in `.facilis/graph.json` |
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

**Status (2026-11-02): the full 16-rule validator is implemented** (D-084): `parseTurn()`
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

**Status (2026-11-04): the project graph runs on static AST facts (D-092).** The `project-graph`
editor tab reads `@facilis/analyze` from a lazy wasm worker over the VFS: pages → routes →
tables plus FK and `relations()` edges, fullscreen, edge filters, drag and a gitignored
`.facilis/graph.json` layout. No manifest/OpenAPI endpoint is needed for the graph; the browser
smoke covers it.

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
- RLS status badges: 🟢 policy defined / 🟡 RLS on, no policy / 🔴 RLS off on scoped table
- Reverse lookup: "used by these routes" (from `x-db-tables`/`x-db-columns`)
- Click to jump to `db/schema.ts` or the route file in Monaco

**Status (2026-11-06): implemented, kernel-mediated connection** (D-083, D-097, O-011).
`@facilis/db` exposes `liveSchemaSnapshot` and `diffSchemaSnapshots`; `GET /__facilis/dev/schema`
is the dev-only transport (404 in production, origin-allowlisted) and the Studio renders it in
the `data` activity view, next to the query console (§11.2). The panel builds every request from
a same-origin `/preview/<port>/…` URL carrying the kernel token, which the Studio's Service
Worker routes to the in-VM dev server; a popped-out preview therefore works, and no embedded
iframe is required. Remaining: the declared half can come from `@facilis/analyze` immediately
(a project that is not running), and preview mode C (wildcard origins, no same-origin SW) needs
its own transport. O-011 tracks both.

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
- Patch validator (16 rules)
- Retry loop — implemented (D-100, no attempt cap since D-108): findings fed back, the model
  reads the files it rewrites with the PTC tools (D-103)
- `requires_confirmation` modal
- Diff view + per-file accept/reject
- Apply → OPFS → HMR → refresh manifest

**Exit criteria:** "Make a todo app" from blank starter produces a working, secure, authenticated app.

**Status (2026-11-02):** Model A (prompt + context), the response parser, the 16-rule validator
(D-084), the proposal/diff review and the apply path are implemented; the §9.4 repair loop
(D-100) is implemented too and the PTC tool runtime is the chat's only mode (D-103); the eval
corpus and browser matrix remain. The validator's warnings still
need a UI surface.

### Phase 5 — Headless Blocks + i18n (2 weeks)

- `@facilis/blocks` packages with `manifest.ts`
- `en` catalog shipped
- Block discovery via `node_modules` scan
- Wire block manifests into AI prompt
- `RoleAssignment` block for admin UI

**Exit criteria:** AI can generate a page using only existing blocks; an admin can assign roles via UI.

### Phase 6 — Polish & MVP Demo (1–2 weeks)

- Starter repo template
- Demo script (< 3 minutes)
- Error surfacing in chat
- Version pinning (`nitro@3.x.x` locked)
- Docs: add-block, add-route, security checklist, roles quickstart

**Exit criteria:** Demo runs reliably on fresh browser session.

**Status (2026-11-02):** the starter template question is settled — the generated project is
`examples/todo-app`, and `starter/` stays empty until `@facilis/*` has a publish target (D-027,
D-062). The demo script is [`DEMO.md`](./DEMO.md) (three minutes, fresh browser, Mock provider
path included); its automated equivalent — `pnpm ide:smoke`, which drives the same flow on a real
headless Chromium — passed on a fresh profile on 2026-11-02. A human rehearsal is still pending,
as are the add-block/add-route/security-checklist pages.

### Phase 7+ — Post-MVP Backlog

- Model B tool surface
- OAuth device flow (GitHub done, D-082; GitLab/Gitea PKCE remains)
- Visual "add resource" wizard
- Flat-JSON data mode
- Column-level `GRANT`
- Block marketplace
- i18n catalog editor
- Collaborative editing (Yjs)
- OpenAPI contract diff (parallel Vivari boot)

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
- `FACILIS_INITIAL_ADMIN` grants admin on first registration
- `/__facilis/manifest` returns full manifest with no warnings
- Background jobs: a `server/jobs/**` definition runs in a system context and returns data;
  `ctx.jobs.enqueue` returns an id; a future-`runAt` job is inspectable and cancellable; a
  persisted queue survives a boot; the example app verifies it in
  `scripts/verify-headless.sh` (D-107)

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
  blocks: {
    packages: ["@facilis/blocks"],
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

The plugin emits `CREATE TABLE roles`, `CREATE TABLE role_permissions`, `CREATE TABLE user_roles`, **and** the seed from your config.

### Step 4 — Set the initial admin (once, in `.env`)

```bash
FACILIS_INITIAL_ADMIN=founder@azienda.it
```

The first registration with that email gets the `admin` role.

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
