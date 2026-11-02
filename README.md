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
- **Pre-constructed elements are code.** Routes, blocks, auth flows, and security policies are standard NPM packages — not UI-managed configuration.
- **The framework enforces the right way.** A route cannot exist without an auth check and a declared DB dependency. A table cannot exist without an RLS policy. The compiler — not a lint rule — makes insecure code impossible to write.
- **You can always escape.** Generated code is just code. Edit it, delete it, replace it. No round-tripping. No lock-in.

---

## What You Get

| | |
|---|---|
| 🧠 **AI scaffolding** | Chat to generate Nitro routes, Drizzle schemas, and React pages built on the plain-CSS `@facilis/ui` kit. AI output is validated against 16 rules before it touches disk. |
| 🛡️ **Structural security** | Session auth middleware + `defineAuthorizedHandler` + Row-Level Security + `drizzle-policy` + Zod. Five independent layers. A bug in one is caught by the next. |
| 🎭 **Roles in code, not DB** | Declare roles and permissions in `facilis.config.ts`. The framework generates the schema and seed. No drift, no admin-panel-only setup. |
| ⚡ **Vite-native runtime** | Nitro v3 runs as a Vite plugin. `vite dev` is the single dev server — one process, one port, one HMR loop for client and server. |
| 🔍 **API visualizer** | Your OpenAPI spec, rendered as an interactive graph. Click a route → jump to its source. Auto-updates on save. |
| 🗃️ **Entity explorer** | Schema introspection from both code and live DB. See drift immediately. Jump from table to the routes that use it. |
| 🚢 **Release preview** | Before you push: see the exact migration SQL, risk-classified (`safe` / `careful` / `destructive` / `breaking`), cross-checked against your API. No more surprise column drops in prod. |
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

The framework auto-generates the schema, the seed, and the RLS policies. Assignments happen at runtime (via admin UI or `POST /api/users/:id/roles`). The first admin is bootstrapped via `FACILIS_INITIAL_ADMIN` env var.

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
│  │  Editor · AI Chat · API Flow · Data · Release │  │
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

## Tech Stack

| Layer | Choice |
|---|---|
| Dev server | [Vite](https://vite.dev) |
| Backend | [Nitro v3](https://nitro.build) — as a Vite plugin, mounted by `facilis()` |
| ORM | [Drizzle](https://orm.drizzle.team) |
| In-browser DB | [PGlite](https://pglite.dev) |
| Frontend (generated app) | React 19 + [`@facilis/ui`](packages/ui) — plain CSS (`.fc-*`) with daisyUI-style role variables, React Router; no utility framework required (D-055/D-058/D-060) |
| Frontend (this IDE) | Tailwind CSS v4 + shadcn/ui (Base UI primitives), inherited from the Vivari Studio fork |
| Runtime | [Vivari](https://github.com/maitrungduc1410/vivari) |
| Validation | [Zod](https://zod.dev) |
| Git client | [isomorphic-git](https://isomorphic-git.org) |
| AI | BYO key (Anthropic, OpenAI, …) |

---

## Try it now

```bash
pnpm install
cd examples/todo-app
FACILIS_INITIAL_ADMIN=admin@example.com PORT=5199 pnpm dev   # → vite dev
```

That's it. One command. One port. Vite serves the React app, the Nitro plugin that `facilis()`
mounts serves `/api/*` and `/__facilis/*`, and PGlite boots inside the Nitro worker. Open
`http://localhost:5199`, register the `FACILIS_INITIAL_ADMIN` email to get `admin`, and watch
`/_openapi.json` carry `x-db-tables` for every route.

```bash
# or verify the whole contract headlessly (auth, RLS, manifest, OpenAPI, guards):
cd examples/todo-app && ./scripts/verify-headless.sh
```

The [three-minute demo script](docs/DEMO.md) walks the same flow in the browser.

The template the IDE scaffolds **is** [`examples/todo-app`](examples/todo-app) (D-062): one
source for the starter, so editing the example changes what "New project" creates.
`starter/` stays empty until `@facilis/*` has a publish target (D-027, D-062): the template is
assembled from the example at build time, so there is no second copy to drift.

---

## Status

**Phases 0–2 are implemented and verified** — the headless suites plus the browser harness
(`pnpm ide:smoke` boots the framework in the IDE's WebContainer: `facilis()` mounts Nitro +
PGlite + `/__facilis/*` on one origin, zero manifest warnings). The Studio (Phase 2) ships at
<https://ide.facilis.dev>: git import/push/publish, tabs, PWA, managed builds. In Phase 3 the
Entity Explorer has landed (D-083); in Phase 4 the AI chat and the full 16-rule patch validator
are implemented (D-084). Generated projects install with **npm** (D-032) from IDE-served
`file:` tarballs, ship **one config** — `facilis.config.ts`, whose optional `nitro` section is
read by `facilis()` — and their `vite.config.ts` is just `[facilis(), react()]` (D-034); the
template pins `@types/react`/`@types/react-dom` so the IDE's TypeScript service resolves
React. See [`docs/DECISIONS.md`](docs/DECISIONS.md), D-022…D-034 and D-063…D-084.

What exists today, runnable in this repo:

| Piece | Where | Evidence |
|---|---|---|
| Core packages (`core`, `db`, `auth`, `nitro`) | `packages/` | unit/integration suites (PGlite-backed), strict TS, zero lint errors |
| Binary storage (`@facilis/storage`) | `packages/storage/` | content-addressed local + S3-compatible drivers (S3/R2/MinIO via SigV4), signed download tokens; 12 tests |
| IDE app (Vivari fork, MIT, starts at `v1.1.2`) | `ide/` | provenance, patch set and `diff -r` against upstream in [`ide/README.md`](ide/README.md) |
| Vivari engine (our fork, git submodule) | `vendor/vivari/` | pinned to `facilis/main` = upstream `v1.2.0` + 19 fork commits (`e654919`); branch map in the fork's `FORK.md`, policy in D-030 |
| Phase 1 acceptance todo app | [`examples/todo-app`](examples/todo-app) | `scripts/verify-headless.sh` asserts auth, RBAC, CRUD, RLS isolation, manifest and `x-db-tables` |
| Facilis project template in the IDE | `ide/src/facilis/` | `pnpm ide:smoke`: green — Home creates a Facilis app (the only creation path, D-051), the preview paints it, manifest zero warnings, `x-db-tables`, 401 on unauthenticated route, and the editor's TypeScript service resolves its imports (no TS2307) |
| Entity Explorer | `ide/src/components/ide/DataExplorerPanel.tsx`, `packages/db/src/live-schema.ts` | `GET /__facilis/dev/schema` (dev-only, D-083) diffs `db/schema.ts` against `pg_catalog`: columns, RLS badges, typed drift, reverse route lookup |
| AI patch validator (16 rules) | `packages/ai/src/`, `ide/src/ai/patch-validation.ts` | SPEC §9.3 implemented (D-084): typed project context, rule 1 through Monaco/rolldown, three validation points (proposal → Apply → VFS write); 48 ai tests, 523 IDE tests |
| Git round-trip and publishing | `ide/src/vv/git-*.ts`, `ide/git-proxy/` | clone/commit/push over HTTPS through a stateless proxy (D-079), publish to GitHub/GitLab/Gitea (D-078), GitHub OAuth device flow (D-082) |
| Deployment profiles and app updates | `ide/vite.deployment.ts`, `ide/src/deploy/` | `open`/`managed` builds with a compiled policy and CSP (D-063/D-064/D-071/D-072), offline update recipes (D-065/D-070) |

Security and delivery choices from the last pass (details in
[`docs/DECISIONS.md`](docs/DECISIONS.md), design in [MANAGED-DEPLOYMENT.md](docs/MANAGED-DEPLOYMENT.md)
and [APP-UPDATES.md](docs/APP-UPDATES.md)):

- **Two build profiles, no server** (D-063/D-064): `open` is today's unrestricted IDE;
  `managed` is the same sources built with one JSON config compiled in — registry mirror,
  package allowlist, import and AI policy, project admission. The build emits `headers.conf`,
  `environment.json`, `mirror-allowlist.json` and `npmrc.template` for the operator.
- **Both profiles ship a CSP** (D-071/D-072), with `'unsafe-eval'` because the kernel
  evaluates the project's code; the hard boundary is the network/registry policy, not eval.
- **Project updates are an offline diff** (D-065): `facilis.app.json` records the build that
  created the project; recipes ship with the build and a rollback-safe engine applies them
  (D-070), moving the marker only after success.
- **AI is opt-in inside the deployment boundary** (D-066): a managed build defaults to off and
  only the providers the config names are reachable. Skills are a reviewed supply chain
  (D-067), not arbitrary content.

The OpenAPI metadata problem found in Phase 0 (A16) is solved in production code: the
`facilis()` plugin mounts Nitro, owns an AST pass over `server/routes`, and answers
`/_openapi.json` with a facade that merges `x-permission`/`x-db-tables`/`x-db-columns` into
Nitro's generated spec.
Decisions and deviations are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

The full specification — architecture, types, endpoint contracts, security model, role lifecycle, AI orchestration, release tooling, phased plan, and acceptance criteria — lives in [`docs/SPEC.md`](docs/SPEC.md).

| Phase | Goal | Est. |
|---|---|---|
| **0** | Feasibility spike (Vivari + Vite/Nitro + PGlite + RLS) | 1–2 wk — headless ✅, browser harness ✅ for the Facilis template |
| **1** | Core packages (`@facilis/*`) | 2–3 wk — ✅ implemented, acceptance app green |
| **2** | Studio extension (chat shell, PAT, multi-project) | 2 wk — ✅ shipped: one project per tab (D-033), real git import/push/publish, GitHub OAuth (D-082), `ide.facilis.dev` (D-077) |
| **3** | Visualizers (API flow, entity explorer, release preview) | 2 wk — 🚧 Entity Explorer ✅ (D-083); API Flow and Release Preview remain |
| **4** | AI orchestration + patch validator | 2–3 wk — 🟡 AI chat ✅ (BYO key, streamed proposal, undo, D-045…D-048) and 16-rule validator ✅ (D-084); retry loop and Model B remain |
| **5** | Headless blocks + i18n + RoleAssignment | 2 wk — 🟡 `@facilis/ui` and `@facilis/i18n-db` shipped; `@facilis/blocks` is still a manifest skeleton |
| **6** | Polish + MVP demo | 1–2 wk — 🟡 template and deployment done; [demo script](docs/DEMO.md) written and its headless equivalent (`pnpm ide:smoke`) green on a fresh profile; human rehearsal and the add-route/add-block/security how-to pages open |

**MVP target:** *"chat → working, secure, authenticated todo app"* in under 3 minutes from a fresh clone.

---

## Read the Spec

The spec is the contract. Every downstream artifact — the AI prompt, the visualizer, the validator, the block manifests — derives from it.

→ **[`docs/SPEC.md`](docs/SPEC.md)** — full specification v1.5

Highlights inside:

- [§3 Architecture](docs/SPEC.md#3-architecture-overview)
- [§6 `/__facilis/manifest` endpoint](docs/SPEC.md#6-the-__facilismanifest-endpoint)
- [§7 Type reference](docs/SPEC.md#7-type-reference)
- [§8 Security model](docs/SPEC.md#8-security-model)
- [§8.4 Role Definition & Assignment](docs/SPEC.md#84-role-definition--assignment)
- [§9 AI orchestration](docs/SPEC.md#9-ai-orchestration)
- [§10.6 Runtime Model Inside Vivari](docs/SPEC.md#106-runtime-model-inside-vivari)
- [§12 Development phases](docs/SPEC.md#12-development-phases)
- [Appendix D — Roles Quickstart](docs/SPEC.md#appendix-d--roles-quickstart)
- [Appendix E — Vite + Nitro Quick Reference](docs/SPEC.md#appendix-e--vite--nitro-quick-reference)

---

## Design Principles (in one line each)

1. **Vivari is the OS.** All filesystem I/O goes through the VFS. Never touch OPFS directly.
2. **Vite is the runtime.** Nitro runs as a plugin. `vite dev` is the only dev command.
3. **The endpoint is a projection.** `/__facilis/manifest` reflects the running project. It is never committed.
4. **Security is structural.** `defineAuthorizedHandler` is the only way to write a route.
5. **Roles are code.** Declared in `facilis.config.ts`, seeded by migrations, assigned at runtime.
6. **Extend via NPM.** Blocks are packages. No plugin registry, no manifest file.
7. **The Studio is a shell.** The product is the framework packages and the OpenAPI contract.
8. **The kit is standard CSS.** `@facilis/ui` ships `.fc-*` classes and role variables, not
   utility classes: a generated app needs no CSS framework to look right (D-055/D-060).

---

## Contributing

Early but real: the framework packages and the acceptance app run today. Contributions
welcome — start with [`AGENTS.md`](AGENTS.md) for conventions and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for the current decision log.

For now, the most useful thing you can do is **read `docs/SPEC.md` and file issues** on anything ambiguous, contradictory, or under-specified.

---

## License

**MIT**

---

<sub>This README is intentionally short. The spec is the depth. If something here disagrees with `docs/SPEC.md`, the spec wins.</sub>

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
