<p align="center">
  <img src="brand/png/facilis-logo-1600.png" alt="facilis.dev" width="520" />
</p>

# Facilis

> **Facilis** (lat. *easy*) — a browser-based framework that makes the right way the easy way, so developers write only the unique 20% of their application.

A static, browser-resident IDE where developers clone a git repo, chat with an AI to scaffold backend + frontend code that follows strict conventions, and ship with confidence — because security, schema safety, and API contracts are structural, not optional.

**Live:** <https://ide.facilis.dev> — the IDE, built and deployed from `main` by
`.github/workflows/deploy-ide.yml` (D-077). The apex `facilis.dev` is reserved for the project site.

---

## Why

"Low-code" has come to mean hidden schemas, config panels, and apps that are impossible to escape. We think that's backwards.

Facilis redefines it:

- **Code is the source of truth.** The UI visualizes and proposes. It never becomes a second source of truth.
- **Pre-constructed elements are code.** Routes, auth flows, and security policies are standard NPM packages — not UI-managed configuration.
- **The framework enforces the right way.** A route cannot exist without an auth check and a declared DB dependency. A table cannot exist without an RLS policy. The compiler — not a lint rule — makes insecure code impossible to write.
- **You can always escape.** Generated code is just code. Edit it, delete it, replace it. No round-tripping. No lock-in.

---

## What You Get

| | |
|---|---|
| 🧠 **AI scaffolding** | Chat to generate Nitro routes, Drizzle schemas, and React pages built on a Tailwind CSS v4 + shadcn-style component layer the project owns. The model runs as a PTC tool loop, and its output is validated against 19 rules before it touches disk. |
| 🛡️ **Structural security** | Session auth middleware + `defineAuthorizedHandler` + Row-Level Security + `drizzle-policy` + Zod. Five independent layers. A bug in one is caught by the next. |
| 🎭 **Roles in code, not DB** | Declare roles and permissions in `facilis.config.ts`. The framework generates the schema, the seed and the RLS policies. No drift, no admin-panel-only setup. |
| ⚡ **Vite-native runtime** | Nitro v3 runs as a Vite plugin. `vite dev` is the single dev server — one process, one port, one HMR loop for client and server. |
| ⏱️ **Background jobs** | A persisted `facilis_jobs` queue with config-driven concurrency, retry and timeout. Definitions live in `server/jobs/**`; `ctx.jobs` enqueues (returning an id), schedules at a future instant, lists the queue and cancels; every run is audited in a system context and guarded by the job's required `dbTables` declaration (D-162). |
| 🔗 **Workflows & approvals** | A persisted `facilis_workflows` chain of job and approval steps advanced by a tick. Definitions live in `server/workflows/**`; a manual step waits on a `facilis_tasks` row until an authorized app route records the decision, and a rejection can continue at a declared step. Jobs and workflows are server-only surfaces with no framework HTTP endpoint (D-135; design [WORKFLOWS.md](docs/WORKFLOWS.md)). |
| 🔐 **Single sign-on** | OIDC, generic OAuth2 and SAML providers declared in `facilis.config.ts`; framework-owned `/api/auth/sso/*` routes with PKCE, nonce/state and verified-email-only account linking (D-120). |
| 📜 **Audit & access logs** | One append-only JSONL pipeline for access, error, audit and app entries. In development they are files under `.facilis/logs/` (opened from the IDE editor); in production they go to stdout or files. Redaction, rotation, hash-chained audit entries, and no HTTP log endpoint by design (D-119). |
| 🔍 **Project graph** | One AST graph over pages, routes, tables, declarative views (D-092/D-160) and workflow definitions (D-161): FK and `relations()` edges, route→view edges, audited elevation, click a card to its source. No booted app needed; it updates on save. |
| 🗃️ **Entity explorer** | Schema introspection from both code and live DB. See drift immediately. Jump from table to the routes that use it. |
| 🚢 **Release preview** | Before you push: the schema plan between release tags, risk-classified (`safe` / `careful` / `destructive` / `breaking`), cross-checked against the API. DDL is generated at release time and applied with a ledger (D-158/D-159). |
| 🌐 **Multi-project** | One project per tab; import a GitHub, GitLab or Gitea/Forgejo repository — private ones with a token used only for that import — or a folder. |
| 🌍 **i18n from day one** | All strings through `t("key")`. API returns codes, not prose. No retrofit. |

---

## Roles in 30 Seconds

Roles and permissions are **declared in code**, not configured through a UI:

```typescript
// facilis.config.ts
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

The framework auto-generates the schema, the seed, and the RLS policies. Assignments happen at runtime through `POST /api/users/:id/roles` (permission `users:manage`); the first admin is bootstrapped once with `FACILIS_INITIAL_ADMIN` and a one-time `FACILIS_INITIAL_ADMIN_TOKEN` (D-150).

Full flow: [§8.4 Role Definition & Assignment](docs/SPEC.md#84-role-definition--assignment).

---

## Architecture

Everything runs **in your browser tab** — including the backend.

```
┌─────────────────────────────────────────────────────┐
│  Static SPA on CDN (COOP/COEP headers)              │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Facilis Studio (fork of Vivari Studio)       │  │
│  │  Editor · AI Chat · Graph · Data · Release   │  │
│  └───────────────────────────────────────────────┘  │
│                       │                             │
│  ┌───────────────────────────────────────────────┐  │
│  │  Vivari WebContainer                          │  │
│  │  ├── Vite dev server  ◄── SINGLE PROCESS      │  │
│  │  │   └── Nitro via facilis() (API + OpenAPI)  │  │
│  │  └── PGlite (WASM Postgres, RLS)              │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   GitHub (PAT)                  LLM provider (BYO key)
```

**One process, one port.** `vite dev` boots Vite; `facilis()` mounts Nitro as a plugin inside it and serves both the React client and the `/api/*` routes from the same origin. Server code runs in an isolated worker and reloads automatically; client code keeps Vite's HMR.

**No backend for the Studio.** No accounts. No infra. Host it on any static CDN.

---

## Try it now

```bash
pnpm install
cd examples/todo-app
FACILIS_INITIAL_ADMIN=admin@example.com \
FACILIS_INITIAL_ADMIN_TOKEN=change-me \
PORT=5199 pnpm dev   # → vite dev
```

That's it. One command. One port. Vite serves the React app, the Nitro plugin that `facilis()`
mounts serves `/api/*` and `/__facilis/*`, and PGlite boots inside the Nitro worker. Open
`http://localhost:5199`, register the `FACILIS_INITIAL_ADMIN` email presenting the token to get
`admin`, and watch `/_openapi.json` carry `x-db-tables` for every route.

```bash
# or verify the whole contract headlessly (auth, RLS, manifest, OpenAPI, guards):
cd examples/todo-app && ./scripts/verify-headless.sh
```

The [three-minute demo script](docs/DEMO.md) walks the same flow in the browser.

The template the IDE scaffolds **is** [`examples/todo-app`](examples/todo-app) (D-062): one
source for the starter, so editing the example changes what "New project" creates.
`starter/` stays empty until `@facilis.dev/*` has a publish target (D-027, D-062): the template is
assembled from the example at build time, so there is no second copy to drift.

---

## Status

Phases 0–4 are implemented and verified (headless suites + the browser harness, `pnpm ide:smoke`); Phase 5 is retired (D-131), Phase 6 (polish + demo) is in progress, and Phase 7+ is the post-MVP backlog. In practice:

- **Chat** — the PTC tool runtime (the only mode, D-101/D-103), the 19-rule validator at proposal/Apply/write and the §9.4 repair loop.
- **Visualizers** — the project graph with pages, explicit links, audited elevation, framework tables, declarative views (D-092/D-134/D-160) and workflow definitions (D-161); Entity Explorer and query console (D-083/D-097); Release Preview on the release-tag plan (D-086/D-158).
- **Platform** — auth + SSO (D-120), external API clients (D-142), jobs (D-107), workflows and manual tasks (D-135), operator logs (D-119), binary storage (D-116/D-117), email verification (D-156).
- **Delivery** — open/managed builds (D-063/D-064), offline app updates (D-065/D-070), release-time DDL and the deploy ledger (D-158/D-159).

Still open: the eval corpus and browser matrix, the skills runtime, the declared-AST half of the Entity Explorer (O-011), preview isolation (D-155) and the post-MVP backlog in the DECISIONS open-items table. The evidence-backed summary is [`docs/STATUS.md`](docs/STATUS.md); the per-phase view is SPEC §12.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Dev server | [Vite](https://vite.dev) |
| Backend | [Nitro v3](https://nitro.build) — as a Vite plugin, mounted by `facilis()` |
| ORM | [Drizzle](https://orm.drizzle.team) |
| In-browser DB | [PGlite](https://pglite.dev) |
| Frontend (generated app) | React 19 + Tailwind CSS v4 + shadcn/ui (Base UI) with the components copied into the project (`src/components/ui`), React Router (D-090; the v1 plain-CSS kit was removed, D-096) |
| Frontend (this IDE) | Tailwind CSS v4 + shadcn/ui (Base UI primitives), inherited from the Vivari Studio fork |
| Runtime | [Vivari](https://github.com/maitrungduc1410/vivari) |
| Validation | [Zod](https://zod.dev) |
| Git client | [isomorphic-git](https://isomorphic-git.org) |
| AI | BYO key (Anthropic, OpenAI, …) |

---

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract.
- [`docs/STATUS.md`](docs/STATUS.md) — where the system is today, with the evidence.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — the decision log (D-001…D-160) and the open-items table.
- [`docs/DEV.md`](docs/DEV.md) — build, run and verify on a bare machine.
- [`docs/DEMO.md`](docs/DEMO.md) — the three-minute demo.
- [`docs/FRONTEND.md`](docs/FRONTEND.md) — the generated app's client contract.
- [`docs/PTC.md`](docs/PTC.md) · [`docs/JOBS.md`](docs/JOBS.md) · [`docs/LOGS.md`](docs/LOGS.md) · [`docs/SSO.md`](docs/SSO.md) · [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) — design references.
- [`docs/MANAGED-DEPLOYMENT.md`](docs/MANAGED-DEPLOYMENT.md) · [`docs/APP-UPDATES.md`](docs/APP-UPDATES.md) · [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) · [`docs/POSTGRES.md`](docs/POSTGRES.md) — deployment and data.
- [`ide/README.md`](ide/README.md) — the Studio fork, its patch set and how to verify it.
- [`docs/README.md`](docs/README.md) — the full map, including the archive.

---

## Design Principles (in one line each)

1. **Vivari is the OS.** All filesystem I/O goes through the VFS. Never touch OPFS directly.
2. **Vite is the runtime.** Nitro runs as a plugin. `vite dev` is the only dev command.
3. **The endpoint is a projection.** `/__facilis/manifest` reflects the running project. It is never committed.
4. **Security is structural.** `defineAuthorizedHandler` is the only way to write a route.
5. **Roles are code.** Declared in `facilis.config.ts`, seeded by migrations, assigned at runtime.
6. **Extend in the project.** Components live in `src/components` as copy-in source (D-090). No plugin registry, no manifest file.
7. **The Studio is a shell.** The product is the framework packages and the OpenAPI contract.
8. **The kit is copy-in source.** Template v2 generates Tailwind CSS v4 + Base UI and ships its
   shadcn-style components as source the project owns (`src/components/ui`); the v1 plain-CSS
   kit was removed (D-096).

---

## Contributing

Facilis is real: the framework packages, the acceptance app and the browser IDE run today. Contributions welcome — start with [`AGENTS.md`](AGENTS.md) for conventions and [`docs/DECISIONS.md`](docs/DECISIONS.md) for the decision log.

**Pull requests are required (policy from 2026-11-12).** Every change reaches `main`
through a pull request with at least one approving review — direct pushes and direct merges
are not allowed. Branch, open the PR with the Definition-of-done evidence (`pnpm lint`,
`pnpm typecheck`, `pnpm test`, `pnpm build`), get one approval, then merge.

For now, the most useful thing you can do is **read `docs/SPEC.md` and file issues** on anything ambiguous, contradictory, or under-specified.

---

## License

**MIT**

---

<sub>This README is the front page; the depth is in the docs. If something here disagrees with `docs/SPEC.md`, the spec wins.</sub>

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
