# Facilis — current state

**Status:** 2026-11-12. This page is the "where are we" summary. The contract is
[`SPEC.md`](./SPEC.md), the why is [`DECISIONS.md`](./DECISIONS.md) and the environment is
[`DEV.md`](./DEV.md). The full documentation map is [`README.md`](./README.md).

## Verdict

Phases 0–4 are implemented and verified. Phase 5 was retired (D-131) and its number stays as a
tombstone; Phase 6 (polish + demo) is in progress; Phase 7+ is the post-MVP backlog. The phase
table is SPEC §12 and the still-open items are the open-items table in DECISIONS.md.

## What ships today

| Area | Where | Evidence |
|---|---|---|
| Framework packages | `packages/` (`core`, `db`, `auth`, `nitro`, `ai`, `analyze`, `time`, `i18n-db`, `storage`) | unit/integration suites (PGlite-backed), strict TypeScript, zero lint errors |
| IDE app | `ide/` — Vivari fork, MIT, starts at upstream `v1.1.2` | provenance, patch set and `diff -r` in [`ide/README.md`](../ide/README.md) |
| Vivari engine | `vendor/vivari/` — git submodule | fork pinned to `facilis/main` = upstream `v1.1.5` + 23 fork commits (`e654919`, D-030) |
| Acceptance app | [`examples/todo-app`](../examples/todo-app) | `scripts/verify-headless.sh`: auth, RBAC, CRUD, RLS, manifest, `x-db-tables`, jobs, attachments |
| Template in the IDE | `ide/src/facilis/` | `pnpm ide:smoke` creates, paints and validates a Facilis app (the only creation path, D-051) |
| Chat + validator | `ide/src/ai/`, `packages/ai/` | PTC runtime — the only mode (D-101/D-103); 19 rules at proposal/Apply/write (D-084/D-162); §9.4 repair loop (D-100); host-side `web_fetch`/`web_image`/`web_download` under the deployment profile gate (D-175) |
| Project graph | `ide/src/components/ide/ProjectGraphPanel.tsx`, `packages/analyze/` | pages, explicit page links, audited elevation, framework tables, declarative views and workflow definitions (D-092/D-134/D-160/D-161); committable layout in `.facilis/graph/` (D-126); per-kind details inspector, line-anchored source snippets, the schematic page mini-page on cards and in the inspector shaped by page kind (D-170, D-176, D-178), and open-in-preview; AI graph tools focus the visible view, search it undirected and screenshot it off-DOM (D-171) |
| Entity Explorer + query console | `ide/src/components/ide/DataExplorerPanel.tsx`, `packages/db/src/` | dev schema diff, read-only SQL console and Create-view (D-083/D-097) |
| Release Preview | `ide/src/components/ide/ReleasePreviewPanel.tsx`, `packages/core/src/release-preview.ts` | risk-classified ref diff (D-086) on the release-tag plan (D-158) |
| Git round-trip + publishing | `ide/src/vv/git-*.ts`, `ide/git-proxy/` | clone/commit/push, GitHub OAuth device flow, hosted publishing (D-078/D-079/D-082) |
| Jobs, workflows + manual tasks | `packages/core/src/jobs*.ts`, `packages/db/src/jobs.ts`, `packages/core/src/workflows*.ts`, `packages/analyze/src/passes/jobs*.ts` | durable queue whose runs are guarded by the job's `dbTables` (D-162, `jobs-gate.test.ts`), system-context runs, chained workflows with approval tasks and a derived table surface (D-107/D-135/D-161/D-162) |
| Single sign-on | `packages/auth/src/sso/`, `packages/nitro/src/routes/sso.ts` | OIDC, generic OAuth2, SAML, verified-email linking (D-120) |
| Logs | `packages/core/src/logging*.ts`, `packages/nitro/src/runtime/logging/` | one JSONL pipeline, redaction/rotation/hash chain, no HTTP endpoint (D-119) |
| Binary storage | `packages/storage/`, `packages/core/src/storage.ts` | content-addressed local + S3 drivers, signed tokens, encryption (D-116/D-117) |
| External API clients | `packages/auth/`, `packages/nitro/` | OAuth2 client-credentials token endpoint and service accounts (D-142/D-143) |
| Email verification | `packages/auth/` | single-use link, unverified-login refusal, SSO claim (D-156) |
| Deployment profiles + updates | `ide/vite.deployment.ts`, `ide/src/deploy/` | open/managed builds, CSP, offline update engine (D-063/D-064/D-065/D-070); `network.connect` also gates the AI's web tools (D-175) |
| Release-time DDL + deploy | `packages/core/src/schema-plan/`, `packages/db/src/schema-digest.ts` | immutable artifact from the tag diff, deploy ledger + fingerprint (D-158/D-159) |

## Evidence (run it)

| Command | Proves |
|---|---|
| `pnpm lint` | oxlint + the 300-line ratchet + the IDE theme check |
| `pnpm typecheck` | strict TypeScript across the workspace |
| `pnpm test` | unit/integration suites (PGlite-backed) |
| `pnpm build` | every package and app builds |
| `pnpm ide:smoke` | the framework boots in the IDE's WebContainer (Wasm/assets/browser setup in DEV.md) |
| `pnpm ide:smoke:multitab` | one project per tab, two tabs at once |
| `examples/todo-app/scripts/verify-headless.sh` | the end-to-end API contract |
| `pnpm pg:e2e` | the Postgres path |

## Open work

- **Phase 4:** the eval corpus and the browser matrix.
- **Skills runtime** and MCP servers on the PTC seam ([AI-SKILLS.md](./AI-SKILLS.md) §7–8).
- **Workflow retention/pruning and a dev inspection endpoint** ([WORKFLOWS.md](./WORKFLOWS.md), O-017).
- **Open decisions:** O-005 (starter repo count), O-010 (auth schema reconcile), O-011
  (declared-AST + preview mode C), O-012 (console RLS mode), O-013 (Entity Explorer views and
  reverse lookup), O-015 (definer-view provenance), O-017 (job workflows/retention), O-018
  (project-file picker), O-019 (log WORM/sinks), O-020 (SSO depth).
- **Phase 6:** human demo rehearsal and the add-route/security-checklist pages.
- **D-155:** preview isolation (SEC-10) is deferred to a dedicated IDE feature.

## Retired / superseded

- The OpenAPI-driven **API Flow** was replaced by the AST project graph (D-092/D-095).
- **`@facilis.dev/blocks`** and Phase 5 are retired (D-131).
- The **v1 plain-CSS kit** is gone; template v2 ships Tailwind CSS v4 + Base UI source (D-090/D-096).
- **`starter/`** was waiting on a publish target; the packages now publish to npm (D-164), so the starter is the next Phase 6 step (D-027/D-062); the template is `examples/todo-app`.
- The **Model A / Model B** split is retired; the chat only uses the PTC runtime (D-101/D-103).
- The gitignored **`.facilis/graph.json`** layout became per-element files (D-126).

## Where the depth is

- [`SPEC.md`](./SPEC.md) — the contract.
- [`DECISIONS.md`](./DECISIONS.md) — the decisions and the open items.
- [`DEV.md`](./DEV.md) — the environment.
- [`FRONTEND.md`](./FRONTEND.md), [`PTC.md`](./PTC.md), [`JOBS.md`](./JOBS.md),
  [`LOGS.md`](./LOGS.md), [`SSO.md`](./SSO.md), [`WORKFLOWS.md`](./WORKFLOWS.md),
  [`MANAGED-DEPLOYMENT.md`](./MANAGED-DEPLOYMENT.md), [`APP-UPDATES.md`](./APP-UPDATES.md),
  [`MIGRATION-PLAN.md`](./MIGRATION-PLAN.md), [`POSTGRES.md`](./POSTGRES.md).
- [`README.md`](./README.md) — the documentation map, including the archive.
