# 📘 Facilis — Full Specification

**Version:** 1.4 (one config; `facilis()` mounts Nitro)
**Status:** Phase 0 headless spike complete; browser/WebContainer items pending
**Purpose:** Single source of truth for development

**Changelog:**

- v1.4 — One project config: Nitro options (and the framework defaults `serverDir: "./server"` / `experimental.openAPI: true`) move into `facilis.config.ts`'s optional `nitro` section, and `facilis()` mounts Nitro and returns `Plugin[]` (D-034). Generated projects have no `nitro.config.ts` and no `nitro()` import.
- v1.3 — Phase 0 headless results: `defineRouteMeta` inside `defineAuthorizedHandler` is **not** detected by Nitro's scanner (A16), so `@facilis/nitro` must ship a framework-owned AST pass + OpenAPI facade (§6.9, §13 risk 3). Fixed §8.4.5 RLS example: tenant isolation must be `AS RESTRICTIVE` and GUC role reads must use `nullif(..., '')` before casting to jsonb. See `spikes/phase0/REPORT.md`.
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
| Frontend | **React 19 + Tailwind CSS v4 + shadcn/ui** (Base UI primitives) |
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
| **Git auth** | Personal Access Token, encrypted in OPFS via WebCrypto |
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
- PAT — one per git host, encrypted, never sent to LLM
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
│  │  │  ├── [NEW] ApiFlowPanel (React Flow)             │  │  │
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
                              (ok)  │  (errors) ──→ Retry (max 2)
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
├── starter/                  Template repo users clone
│   ├── server/               (Nitro server dir)
│   │   └── routes/
│   │       └── api/
│   │           └── todos/
│   │               ├── index.get.ts
│   │               ├── index.post.ts
│   │               └── [id].patch.ts
│   ├── src/                  (React client)
│   │   └── App.tsx
│   ├── db/
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── locales/en.json
│   ├── vite.config.ts        ◄── plugins: [facilis(), react()]
│   ├── facilis.config.ts     ◄── release.ref, db, i18n, blocks, auth, nitro
│   ├── package.json          ◄── scripts.dev = "vite dev"
│   └── README.md
│
├── examples/
│   ├── todo-app/
│   └── blog-json/
│
├── pnpm-workspace.yaml
└── turbo.json
```

### 4.2 Generated Project Layout

```
<project>/
├── server/                       Nitro server root (serverDir)
│   └── routes/api/todos/
│       ├── index.get.ts          defineAuthorizedHandler
│       ├── index.post.ts
│       ├── [id].get.ts
│       ├── [id].patch.ts
│       └── [id].delete.ts
├── src/                          React client
│   └── pages/todos/index.tsx     uses @facilis/blocks
├── db/
│   ├── schema.ts                 Drizzle tables + policies + auth re-export
│   └── migrations/               drizzle-kit output (incl. auth seed)
├── locales/en.json
├── vite.config.ts                plugins: [facilis(), react()]
├── facilis.config.ts             the one config: roles, permissions, nitro options
├── package.json                  scripts.dev = "vite dev"
└── README.md
```

**Note:** Nitro v3 in Vite mode requires the server directory to be declared via `serverDir`. `facilis()` mounts Nitro and supplies it from `facilis.config.ts`: the framework defaults are `serverDir: "./server"` and `experimental.openAPI: true`, and a project overrides only what it changes in the config's optional `nitro` section. Route files live under `server/routes/`, not `routes/` at project root.

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

// Release tooling
export type {
  ReleasePreview,
  SchemaDiff,
  MigrationStatement,
  RiskClass,
  ApiDiff,
  SecurityDiff,
  BreakingChange,
  ReleaseWarning,
  GitRef,
} from "./release"

// i18n
export { t } from "./i18n"
```

### 5.2 `@facilis/db`

Exports:

- `createDb()` — Drizzle client for PGlite (dev) / Postgres (prod)
- `policyContext` — `drizzle-policy` wrapper for tenant/role scoping
- `rlsMigrationPlugin` — Drizzle-kit plugin that auto-appends RLS policies
- `buildReleasePreview(from, to)` — schema diff engine
- `PolicyScopedDatabase` — type of the db object passed to handlers

### 5.3 `@facilis/auth`

Exports:

- `sessionMiddleware` — Nitro middleware populating `event.context.user`
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
  tenantId: uuid("tenant_id").notNull(),
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
- `validatePatch(patch, manifest)` — 16-rule validator
- `applyPatch(controller, patch)` — writes through `kernel.writeFiles`

### 5.6 `@facilis/nitro` — Vite plugin + Nitro module

This package has **two entry points**: the Vite plugin (which also mounts Nitro) and the Nitro module it carries.

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

export function facilis(options?: FacilisOptions): FacilisPlugins {
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

**Why two entry points?** Vite plugins can extend Nitro programmatically by exposing a `nitro` key (a Nitro module) on the plugin object, and Nitro's own plugin mounts by returning `Plugin[]`. `facilis()` is both: it returns the Facilis plugin carrying the module, followed by `nitro()`'s plugins. The user writes one plugin in `vite.config.ts` and gets Nitro plus all `__facilis` routes, virtual modules, and collectors.

---

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
| `/__facilis/dev/schema` | Full schema introspection (Phase 4) | `SchemaSnapshot` |
| `/__facilis/dev/query` | Read-only SQL console (Phase 4) | `{ columns, rows, rowCount, elapsedMs }` |

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

**Phase 0 result (verified, 2026-10-25): Nitro's scanner only accepts a *top-level* `defineRouteMeta` call. A call inside the wrapper is invisible to it, so the native path does not work (A16 = fail).** Therefore `@facilis/nitro` **must** ship a framework-owned AST pass that statically extracts the wrapper config into a virtual module, plus a facade that merges it into Nitro's generated spec and serves it at `/_openapi.json`. Nitro's own spec stays intact on an internal dev-only route (`/_facilis/openapi.json`). Prototype and evidence: `spikes/phase0/` (§3 of its REPORT).

Consequences to carry into Phase 1: static analysis only sees object-literal configs (values imported from other modules are not resolved — add a lint/review check), and route-file edits must invalidate the virtual module via the Vite module graph so HMR keeps the spec fresh.

**Phase 1 implementation notes (verified):** the metadata virtual module is owned by the
`facilis()` **Vite plugin**, not by a Nitro virtual module — inside the Nitro environment,
Nitro's virtual plugin resolves that id before user plugins and served stale metadata across
edits (HMR broke). Non-static values are never guessed: they are omitted and reported as
`meta-not-static` manifest warnings plus an `x-facilis-warning` extension on the operation.
The facade answers `200` with an `openapi-unavailable` warning when Nitro's generator is
disabled, and `404` in production unless `openAPI.production` is enabled.

---

## 7. Type Reference

### 7.1 `FacilisConfig`

```typescript
interface FacilisConfig {
  release: { ref: string }
  db: {
    mode: "pglite" | "postgres" | "json"
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
}

interface AuthContext {
  userId: string
  tenantId: string
  roles: string[]
  permissions: string[]                       // already expanded from roles
}

function defineAuthorizedHandler<B, Q, P>(
  config: AuthorizedHandlerConfig<B, Q, P>,
  handler: (event: H3Event, ctx: AuthorizedHandlerContext<B, Q, P>) => Promise<unknown> | unknown,
): EventHandler
```

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
  dbTables: string[]
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

3. event.context.user = { userId, tenantId, roles, perms }

4. defineAuthorizedHandler checks `permission` against perms
   → 403 if missing, before handler runs

5. policyContext.run({ userId, tenantId, roles }, ...)
   → SET LOCAL app.user_id    = '<uuid>'
   → SET LOCAL app.tenant_id  = '<uuid>'
   → SET LOCAL app.roles      = '["manager"]'

6. Handler runs. RLS evaluates policies on every query.
```

**Why expand permissions from config, not from `role_permissions` table?** Because the config is the source of truth. Querying `role_permissions` on every request would (a) add a DB roundtrip, (b) create a second source of truth that could drift.

#### 8.4.5 RLS Policies with App Roles

**Only app roles.** No Postgres `CREATE ROLE` / `SET ROLE` / `TO manager_role`. All policies read `current_setting('app.roles')::jsonb`.

**Example — documents where admins see all, others see their own:**

```typescript
// documents.ts (your schema)
import { pgTable, pgPolicy, uuid, text, sql } from "drizzle-orm/pg-core"

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  ownerId: uuid("owner_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
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

**Why `AS RESTRICTIVE` and `nullif`?** Postgres ORs multiple *permissive* policies for the same command, so a permissive tenant policy would not constrain the admin clause — admins would see other tenants; see `spikes/phase0/REPORT.md` §4. Tenant isolation must be `AS RESTRICTIVE` (AND-ed) so it always applies. The `nullif(..., '')` guard covers the GUC lifecycle: after `RESET app.roles` the setting is `''`, and `''::jsonb` raises `invalid input syntax for type json`. PGlite connects as a superuser and bypasses RLS even with `FORCE`, so tests must `SET ROLE` to a non-superuser (verified in `spikes/phase0/tests/pglite-rls.test.ts`).

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
| `/__facilis/health` | 404 in prod |

### 8.6 Application-Level Security Rules

- AI patches are **validated** before write (16 rules, §9.3)
- AI never receives PATs or secrets
- Superuser query results are **never** persisted or sent to LLM
- Query console is read-only by construction
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

### 9.2 System Prompt (Shared Core)

Rules the AI must obey:

1. Every route uses `defineAuthorizedHandler`
2. `dbTables` and `permission` required
3. Zod schemas for any used input
4. All scoped tables get RLS policies in the same patch
5. Use existing blocks; do not create new ones unprompted
6. All strings via `t("key")`
7. Minimal patches; match existing style
8. Output is a single `AIResponse` JSON object; no prose outside
9. **Do not invent permissions or roles.** If a route needs a permission not declared in `facilis.config.ts`, add it to `config.auth.permissions` in the same patch and note it in `notes`. Same for new roles.

### 9.3 Patch Validator (16 Rules)

| # | Rule | Severity | Checks |
|---|---|---|---|
| 1 | `ts-parse` | error | TypeScript compiles |
| 2 | `route-security` | error | Every route uses `defineAuthorizedHandler` |
| 3 | `db-tables-present` | error | `dbTables` field present (empty OK) |
| 4 | `db-tables-valid` | error | All `dbTables` exist in schema (or this patch) |
| 5 | `db-columns-valid` | warning | All `dbColumns` format and exist |
| 6 | `permission-valid` | error | Every `permission` exists in `config.auth.permissions` |
| 7 | `block-import-valid` | error | Every block import matches a `BlockManifest` |
| 8 | `route-input-validated` | error | Handler uses `body.x` → Zod schema required |
| 9 | `no-raw-db-access` | error | No raw Drizzle client imports outside `@facilis/db` |
| 10 | `rls-on-scoped-table` | error | New scoped table ships with a `pgPolicy` |
| 11 | `file-path-allowed` | error | Files only in `server/`, `src/`, `db/`, `lib/`, `components/`, `locales/` |
| 12 | `import-resolves` | error | All imports resolve (relative or in `node_modules`) |
| 13 | `i18n-keys-registered` | warning | All `t("key")` calls have keys in `locales/en.json` |
| 14 | `migration-generated` | warning | Schema changes ship with a migration file |
| 15 | `destructive-confirmed` | error | Destructive schema → `requires_confirmation: true` |
| 16 | `role-config-sync` | error | If patch modifies `facilis.config.ts` roles/permissions, a new migration file must update seeds |

### 9.4 Retry Loop

```
Turn 1 → AI responds → validate → (errors) → retry 1 → validate → (errors) → retry 2 → validate → fail
```

- **Max 2 retries.** Worst case 3× initial token cost.
- Failures feed back with `fix_hint` + `excerpt` per error, not full files.
- On final failure: show errors in chat; do not write to OPFS.

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
- Multi-root workspace support (foundation for multi-project)

### 10.2 What We Add

| Feature | Location | Approach |
|---|---|---|
| AI Chat | `ChatPanel.tsx` + new activity | Calls `controller.applyPatch()` |
| API Visualizer | `ApiFlowPanel.tsx` + new tab kind | React Flow; fetches `/__facilis/manifest` |
| Entity Explorer | `DataExplorerPanel.tsx` + new tab kind | Fetches schema; shows code ↔ live DB diff |
| Release Preview | `ReleasePreviewPanel.tsx` + new tab kind | `buildReleasePreview(from, to)` |
| Project Switcher | Extend `Home.tsx` | Uses `ProjectRegistry` + PAT auth |
| PAT Auth | Extend git modal | WebCrypto storage in OPFS |
| `applyPatch()` | `IdeController` method | Writes through `kernel.writeFiles` |

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

- Reads from both `db/schema.ts` (via `getTableConfig`) and PGlite `information_schema`
- **Diffs them**: shows drift like *"code says X, DB says Y — run `drizzle-kit migrate`"*
- RLS status badges: 🟢 policy defined / 🟡 RLS on, no policy / 🔴 RLS off on scoped table
- Reverse lookup: "used by these routes" (from `x-db-tables`)
- Click to jump to `db/schema.ts` or route file in Monaco

### 11.2 Query Preview (Phase 4)

- Runs through Nitro (`POST /__facilis/dev/query`), never SPA → PGlite directly
- **RLS mode selector**: superuser (with warning) or as a specific user/role — sets `app.*` session vars
- **Read-only by construction** — SQL prefix check rejects writes
- Results never persisted, never in LLM prompts

### 11.3 Release Preview (Phase 3.5)

Four diff lenses, one engine:

| Lens | Compares | Answers |
|---|---|---|
| Code ↔ Live DB | `db/schema.ts` vs `information_schema` | In sync? |
| Working copy ↔ HEAD | OPFS vs last commit | What am I about to commit? |
| HEAD ↔ origin/main | Local vs remote | What ships on next deploy? |
| origin/main ↔ Tag | Remote vs release ref | What changed since last release? |

**Risk classification per statement:**

- 🟢 Safe: add nullable column, add table, add index, add policy
- 🟡 Careful: non-null without default, add UNIQUE, rename
- 🟠 Destructive: drop column/table, narrow type, tighten RLS
- 🔴 Breaking: drops referenced by routes (cross-checked with `x-db-columns`)

### 11.4 Dev-Only Endpoints

| Endpoint | Purpose | Guard |
|---|---|---|
| `GET /__facilis/dev/schema` | Full introspection | 404 in prod |
| `POST /__facilis/dev/query` | Read-only SQL | 404 in prod, read-only prefix check |
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

- API Flow panel (React Flow, `/_openapi.json` → nodes/edges)
- Entity Explorer (schema + drift diff)
- Release Preview (schema migration + risk classification + RLS diff)
- Code jump: click node → Monaco opens file

**Exit criteria:** Hand-editing a route updates the graph within seconds. Drift between code and DB is visible.

### Phase 4 — AI Orchestration (2–3 weeks)

- Prompt builder + context assembly (Model A)
- AIResponse parser
- Patch validator (16 rules)
- Retry loop
- `requires_confirmation` modal
- Diff view + per-file accept/reject
- Apply → OPFS → HMR → refresh manifest

**Exit criteria:** "Make a todo app" from blank starter produces a working, secure, authenticated app.

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

### Phase 7+ — Post-MVP Backlog

- Model B tool surface
- OAuth device flow (replace PAT UX)
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
| 3 | **`defineRouteMeta` in wrapper not scanned** — **confirmed in Phase 0** | No `x-db-tables` in OpenAPI | Framework-owned AST pass + OpenAPI facade is **required**; prototype verified in `spikes/phase0` (§6.9). Static analysis sees object-literal configs only, and route-edit invalidation must be wired in Phase 1. |
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

**Status (2026-10-28):** the browser half is scripted. `TEMPLATE=Facilis pnpm ide:smoke`
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
