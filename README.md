# Facilis

> **Facilis** (lat. *easy*) — a browser-based framework that makes the right way the easy way, so developers write only the unique 20% of their application.

A static, browser-resident IDE where developers clone a git repo, chat with an AI to scaffold backend + frontend code that follows strict conventions, and ship with confidence — because security, schema safety, and API contracts are structural, not optional.

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
| 🧠 **AI scaffolding** | Chat to generate Nitro routes, Drizzle schemas, and Tailwind + shadcn pages. AI output is validated against 16 rules before it touches disk. |
| 🛡️ **Structural security** | Session auth middleware + `defineAuthorizedHandler` + Row-Level Security + `drizzle-policy` + Zod. Five independent layers. A bug in one is caught by the next. |
| 🎭 **Roles in code, not DB** | Declare roles and permissions in `facilis.config.ts`. The framework generates the schema and seed. No drift, no admin-panel-only setup. |
| ⚡ **Vite-native runtime** | Nitro v3 runs as a Vite plugin. `vite dev` is the single dev server — one process, one port, one HMR loop for client and server. |
| 🔍 **API visualizer** | Your OpenAPI spec, rendered as an interactive graph. Click a route → jump to its source. Auto-updates on save. |
| 🗃️ **Entity explorer** | Schema introspection from both code and live DB. See drift immediately. Jump from table to the routes that use it. |
| 🚢 **Release preview** | Before you push: see the exact migration SQL, risk-classified (`safe` / `careful` / `destructive` / `breaking`), cross-checked against your API. No more surprise column drops in prod. |
| 🌐 **Multi-project** | Switch git repos like any IDE. PAT-per-host, encrypted in OPFS. |
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
│  │  │   └── nitro() plugin (API + OpenAPI)       │  │
│  │  └── PGlite (WASM Postgres, RLS)              │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   GitHub (PAT)                  LLM provider (BYO key)
```

**One process, one port.** `vite dev` boots Vite; Nitro mounts as a plugin inside it and serves both the React client and the `/api/*` routes from the same origin. Server code runs in an isolated worker and reloads automatically; client code keeps Vite's HMR.

**No backend for the Studio.** No accounts. No infra. Host it on any static CDN.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Dev server | [Vite](https://vite.dev) |
| Backend | [Nitro v3](https://nitro.build) — as a Vite plugin (`nitro/vite`) |
| ORM | [Drizzle](https://orm.drizzle.team) |
| In-browser DB | [PGlite](https://pglite.dev) |
| Frontend | React 19 + [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) (Base UI primitives) |
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

That's it. One command. One port. Vite serves the React app, the Nitro plugin serves `/api/*`
and `/__facilis/*`, and PGlite boots inside the Nitro worker. Open
`http://localhost:5199`, register the `FACILIS_INITIAL_ADMIN` email to get `admin`, and watch
`/_openapi.json` carry `x-db-tables` for every route.

```bash
# or verify the whole contract headlessly (auth, RLS, manifest, OpenAPI, guards):
cd examples/todo-app && ./scripts/verify-headless.sh
```

The starter template (`starter/`) is Phase 2 work; `examples/todo-app` is the hand-written
reference the generator will reproduce.

---

## Status

**Phase 1 implemented and verified headlessly. Browser/WebContainer items (Phase 0 A1-A3,
A6, A8-A12) still need a browser harness.**

What exists today, runnable in this repo:

| Piece | Where | Evidence |
|---|---|---|
| Core packages (`core`, `db`, `auth`, `nitro`) | `packages/` | 175 unit/integration tests, strict TS, zero lint errors |
| Studio app (Vivari fork, MIT, pinned commit) | `studio/` | provenance/sync notes in [`vendor/vivari/FACILIS.md`](vendor/vivari/FACILIS.md) |
| Vivari kernel sources (pinned, vendored) | `vendor/vivari/` | upstream tree, excluded from all gates |
| Phase 1 acceptance todo app | [`examples/todo-app`](examples/todo-app) | `scripts/verify-headless.sh` asserts auth, RBAC, CRUD, RLS isolation, manifest and `x-db-tables` |

The OpenAPI metadata problem found in Phase 0 (A16) is solved in production code: the
`facilis()` plugin owns an AST pass over `server/routes`, and `/_openapi.json` is a facade
that merges `x-permission`/`x-db-tables`/`x-db-columns` into Nitro's generated spec.
Decisions and deviations are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

The full specification — architecture, types, endpoint contracts, security model, role lifecycle, AI orchestration, release tooling, phased plan, and acceptance criteria — lives in [`docs/SPEC.md`](docs/SPEC.md).

| Phase | Goal | Est. |
|---|---|---|
| **0** | Feasibility spike (Vivari + Vite/Nitro + PGlite + RLS) | 1–2 wk — headless ✅, browser items pending |
| **1** | Core packages (`@facilis/*`) | 2–3 wk — ✅ implemented, acceptance app green |
| **2** | Studio extension (chat shell, PAT, multi-project) | 2 wk |
| **3** | Visualizers (API flow, entity explorer, release preview) | 2 wk |
| **4** | AI orchestration + patch validator | 2–3 wk |
| **5** | Headless blocks + i18n + RoleAssignment | 2 wk |
| **6** | Polish + MVP demo | 1–2 wk |

**MVP target:** *"chat → working, secure, authenticated todo app"* in under 3 minutes from a fresh clone.

---

## Read the Spec

The spec is the contract. Every downstream artifact — the AI prompt, the visualizer, the validator, the block manifests — derives from it.

→ **[`docs/SPEC.md`](docs/SPEC.md)** — full specification v1.3

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
