# Facilis — current state

**Status:** 2026-11-24. This page is the "where are we" summary. The contract is
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
| Vivari engine | `vendor/vivari/` — git submodule | fork pinned to `facilis/main` = upstream `v1.3.4` + 1 post-release commit + 20 fork commits (`d2a8d52`, D-030) |
| Acceptance app | [`examples/todo-app`](../examples/todo-app) | `scripts/verify-headless.sh`: auth, RBAC, CRUD, RLS, manifest, `x-db-tables`, jobs, attachments |
| Showcase example | [`examples/showcase-app`](../examples/showcase-app) | static, frontend-only showcase with prerendered static and public-API pages (#161); a template kind in the creation picker (D-168) |
| Template in the IDE | `ide/src/facilis/` | `pnpm ide:smoke` creates, paints and validates a Facilis app (the only creation path, D-051; example-backed template kinds via a picker, D-168) |
| Chat + validator | `ide/src/ai/`, `packages/ai/` | PTC runtime — the only mode (D-101/D-103); 19 rules at `validate`/write (D-084/D-162); incremental validated `write_file`/`delete_file` tools behind a clean-tree git gate with a commit-and-continue/stop pause (an AI-generated, editable commit summary) and turn Undo from HEAD (D-181/D-192); a message-and-script answer that never carries patches, ends with a summary and shows a git-changes footer outside the transcript (D-192); §9.4 shape-repair loop (D-100); host-side `web_fetch`/`web_image`/`web_download` under the deployment profile gate (D-175); UI pattern defaults from [UI-PATTERNS.md](./UI-PATTERNS.md) applied by the prompt, with an ask-first rule when the layout is open (D-186); the transcript follows only near the bottom, with a pin and jump-to-latest (D-187) |
| Project graph | `ide/src/components/ide/ProjectGraphPanel.tsx`, `packages/analyze/` | pages, explicit page links, audited elevation, framework tables, declarative views and workflow definitions (D-092/D-134/D-160/D-161); committable layout in `.facilis/graph/` (D-126); per-kind details inspector, line-anchored source snippets, the schematic page mini-page on cards and in the inspector shaped by page kind (D-170, D-176, D-178), and open-in-preview; AI graph tools focus the visible view, search it undirected and screenshot it off-DOM (D-171) |
| Entity Explorer + query console | `ide/src/components/ide/DataExplorerPanel.tsx`, `packages/db/src/` | dev schema diff, read-only SQL console and Create-view (D-083/D-097) |
| Release Preview | `ide/src/components/ide/ReleasePreviewPanel.tsx`, `packages/core/src/release-preview.ts` | risk-classified ref diff (D-086) on the release-tag plan (D-158) |
| Prerendering + hydration | `packages/nitro/src/prerender*.ts`, `packages/core/src/prerender-config.ts` | opt-in in-process build pass for declared public pages: per-route HTML + state island, hydrated not SSR; param routes ineligible, fail-closed (D-202, #158; spike evidence in [findings/prerender-hydration.md](./findings/prerender-hydration.md)) |
| Git round-trip + publishing | `ide/src/vv/git-*.ts`, `ide/git-proxy/` | clone/commit/push, GitHub OAuth device flow, hosted publishing (D-078/D-079/D-082) |
| Jobs, workflows + manual tasks | `packages/core/src/jobs*.ts`, `packages/db/src/jobs.ts`, `packages/core/src/workflows*.ts`, `packages/analyze/src/passes/jobs*.ts` | durable queue whose runs are guarded by the job's `dbTables` (D-162, `jobs-gate.test.ts`), system-context runs, chained workflows with approval tasks and a derived table surface (D-107/D-135/D-161/D-162) |
| Single sign-on | `packages/auth/src/sso/`, `packages/nitro/src/routes/sso.ts` | OIDC, generic OAuth2, SAML, verified-email linking (D-120) |
| Logs | `packages/core/src/logging*.ts`, `packages/nitro/src/runtime/logging/` | one JSONL pipeline, redaction/rotation/hash chain, no HTTP endpoint (D-119) |
| Binary storage | `packages/storage/`, `packages/core/src/storage.ts` | content-addressed local + S3 drivers, signed tokens, encryption (D-116/D-117) |
| External API clients | `packages/auth/`, `packages/nitro/` | OAuth2 client-credentials token endpoint and service accounts (D-142/D-143) |
| Email verification | `packages/auth/` | single-use link, unverified-login refusal, SSO claim (D-156) |
| Deployment profiles + updates | `ide/vite.deployment.ts`, `ide/src/deploy/` | open/managed builds, CSP, offline update engine (D-063/D-064/D-065/D-070); `network.connect` also gates the AI's web tools (D-175) |
| Release-time DDL | `packages/core/src/schema-plan/`, `packages/db/src/schema-digest.ts` | immutable artifact from the tag diff + canonical schema digest (D-158); no deploy applier ships (D-204) |

## Evidence (run it)

| Command | Proves |
|---|---|
| `pnpm lint` | oxlint + the 300-line ratchet + the IDE theme check |
| `pnpm typecheck` | strict TypeScript across the workspace |
| `pnpm test` | unit/integration suites (PGlite-backed) |
| `pnpm build` | every package and app builds |
| `pnpm ide:smoke` | the framework boots in the IDE's WebContainer (Wasm/assets/browser setup in DEV.md) |
| `pnpm ide:smoke:multitab` | one project per tab, two tabs at once |
| `pnpm ide:smoke:prerender` | the in-VM prerender build + preview (D-202, #85): ~50-route fixture, hydration, fail-closed ineligible build |
| `examples/todo-app/scripts/verify-headless.sh` | the end-to-end API contract |
| `pnpm pg:e2e` | the Postgres path |

## Open work

- **Phase 4:** the eval corpus and the browser matrix.
- **Production observability** via OpenTelemetry — implemented (D-203, D-209, D-210; epic #131): backend spans, frontend RUM, a framework-owned ingestion endpoint and operator collector guidance ([TELEMETRY.md](./TELEMETRY.md)); the D-119 log pipeline stays separate.
- **MCP polish:** the settings UI and the managed allowlist on the shipped MCP client (D-118; PTC.md phase 3 remainder). The skills extension is withdrawn (D-205); [AI-SKILLS.md](./AI-SKILLS.md) §8 keeps the design as history.
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
- **`starter/`** never became a directory: the packages publish to npm (D-164) and the template is `examples/todo-app`, inlined at build time (D-062); a standalone starter repo remains an open question (O-005, D-027).
- The **canvas-first project graph** (epic #56) was reverted (#156); the project graph stays the schematic card view with its details inspector.
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
