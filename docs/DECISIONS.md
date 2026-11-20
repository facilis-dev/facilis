# Decision log

ADR-style log for Facilis. The contract lives in [`docs/SPEC.md`](./SPEC.md); this log records
decisions taken **around** the spec (toolchain, conventions, ambiguities resolved) so they are not
re-litigated or lost.

Format: `D-0NN — title` · **status** (accepted / open) · context · decision · consequences.

**One file per decision.** Each entry is `D-0NN-<slug>.md` in [`docs/decisions/`](./decisions/),
and [its index](./decisions/README.md) lists every ID with title, status and date. One entry per
file is deliberate: the log used to be a single appended file, so every pair of branches conflicted
there and two branches could take the same number (D-197 did, and became D-201). A `D-0NN`
reference in code or docs resolves to the file whose name starts with that ID.

**To add a decision.** Create `docs/decisions/D-<next>-<slug>.md` — `# D-0NN — title` as the first
line, `**Status:** accepted (YYYY-MM-DD)` on the next one — then run `pnpm decisions:index`.
`node scripts/check-decisions.mjs` (part of `pnpm lint`) rejects a duplicate number, a slug that
does not match the title, and a stale index. This page is stable: it carries the reading guide and
the open items, and adding a decision never edits it.

**Reading guide.** Start with the newest entries, from D-142 on; the rest is history that still
explains the current code. A handful of decisions are superseded by a later one — D-017
(→ D-018/D-019), D-018 (→ D-030), D-022 (→ D-032), D-055 (→ D-090, then D-096), D-085/D-087
(→ D-095), D-151 (→ D-156) — and D-086/D-143 were amended by D-158/D-159 and D-149,
D-032 was completed by D-164/D-166, while D-157 was extended to jobs by D-162 and D-002's `.nvmrc`
pin was superseded by D-182. The "Open items" table at the end lists what is still undecided.

---

## Open items (post-MVP)

Rows marked `done` are kept so their O-IDs stay resolvable; only the rows without a resolution are
live. The resolving ADR is in the row.

| ID | Question | Proposed default | Needed by |
|---|---|---|---|
| O-001 | i18n key format: flat (`todos.title`) vs nested (`todos.form.title`) | **resolved in Phase 1: flat keys** (`t()` in `@facilis.dev/core`, `locales/en.json`) | done |
| O-002 | Canonical API error-code registry | **resolved in Phase 1:** `FacilisErrorCode` union in `@facilis.dev/core` (`unauthorized`, `forbidden`, `invalid_input`, `conflict`, `db_unavailable`, `not_found`, `storage_unavailable`, `file_too_large`, `unsupported_media_type` — D-141, `too_many_requests` — D-143, `payload_too_large` — D-153, `email_unverified` — D-156, `internal_error`), serialized as `{ code, details? }` — no prose | done |
| O-003 | Tenancy: `users.tenantId` exists but no `tenants` table (spec §5.3 vs §8.4.2) | **resolved in Phase 1:** single-tenant deployment; tenant comes from `FACILIS_TENANT_ID` (`defaultTenantId` in the event context). A `tenants` table arrives only with multi-tenant | done |
| O-004 | Block discovery: `node_modules` scan vs explicit registration | **resolved by D-131:** no block supply chain — Phase 5 retired and `@facilis.dev/blocks` deleted; nothing to discover | done |
| O-005 | Starter repo count (one todo template vs several) | one `starter/` todo template for MVP | Phase 6 |
| O-006 | Publish target for `@facilis.dev/*` (public npm vs private registry) | **resolved by D-164:** public npm under the `facilis.dev` organization, published by the release job in `.github/workflows/deploy-ide.yml` on every deploy at the versions committed in the package manifests (D-166, D-198) | done |
| O-007 | Recommended default AI model | **resolved with D-045:** no enforced default; each provider preset carries an editable model default | done |
| O-008 | Release-preview boot strategy (sequential boots vs `?at=<oid>`) | **resolved with D-086:** no boot — the Studio reads the refs from the git tree with isomorphic-git and diffs parsed snapshots | done |
| O-009 | Validator rule 11 path allowlist vs rule 16 | **resolved with D-084:** the allowlist is the six project roots plus `facilis.config.ts`; root `AGENTS.md` only through the IDE writer's explicit `rootFiles`; rule 16 handles role/config sync via a migration in the same patch. **Revisited by D-167:** the write scope follows the deployment profile — `open` allows the project minus the install surface, the VCS/IDE/build state and `AGENTS.md`, `managed` keeps the six roots — while `package.json`, lockfiles and `.npmrc` stay blocked in both | done |
| O-010 | Auth schema drift: Drizzle (`tenantId` notNull) vs SQL seed PK/NOT NULL | reconcile in `@facilis.dev/auth/db`; one source (Drizzle schema) generates the SQL | Phase 1 (auth) |
| O-011 | Data Explorer connection when the app runs in its own preview tab and in the isolated preview modes | **partly resolved by D-097:** the live transport is kernel-mediated (same-origin `/preview/<port>/…` through the Studio's SW), so a popped-out preview works in modes A/B. Still open: declared tables from `@facilis.dev/analyze` for a project that is not running, and preview mode C (wildcard origins register no same-origin SW) | Phase 3.5 follow-up |
| O-012 | Query console RLS mode: the console runs as the connecting superuser (developer preview), so it does not show what a user sees | add the SPEC §11.2 selector — run the statement as `facilis_app` with a chosen `app.*` scope, next to the developer mode | Phase 3.5 follow-up |
| O-013 | Views in analyzer facts, graph and reverse lookup | **resolved for the project graph by D-160:** `ViewFact` becomes a `view:<name>` node (invoker/definer, permission, base tables), a route that declares a view in `dbTables` gets a `route-view` edge and the declared base tables get `view-base` edges; `defineView` facts and the validator were D-157. Still open: the Entity Explorer's declared views and its reverse lookup | Phase 4 (Entity Explorer half) |
| O-014 | Log pipeline and retention beyond the local file | **resolved by D-119:** one JSONL pipeline, redaction/rotation/hash chain and env-owned sinks; WORM/external sinks remain O-019 | done |
| O-015 | Definer-view reads are permission-gated but not logged per query | keep reads unaudited (a view is a table-like resource); if read provenance is required, add an explicit route helper or a database-level statement audit (`pgaudit`/log-statement), not a per-query framework hook | Phase 4 |
| O-016 | Model B: replace preloaded context with a PTC tool runtime — the model writes one JavaScript program per step, the IDE executes it in a locked sandbox against a read-only tool registry (files, analyzer facts, manifest; MCP later). | **resolved with D-101:** PTC pure (`script` XOR `patches`), opaque-origin iframe + inner blob Worker (phase-0 spike 21/21), read-only tools plus a `validate` self-check, final §9.3 gate kept as the safety net. Design: [PTC.md](./PTC.md). | done |
| O-017 | Background jobs: a workflow/chaining construct, retention & pruning of `facilis_jobs`, exponential backoff, multi-instance/distributed workers, a dev-only inspection endpoint | **durable claim/attempt counters are the seam; a workflow is a separate construct** (docs/JOBS.md §10) — design approved in D-135 ([WORKFLOWS.md](./WORKFLOWS.md)); W1–W3 landed (SPEC §7.10); retention/pruning and the dev-only inspection endpoint remain | Phase 7+ |
| O-018 | AI chat UX: the IDE transcript should feel like the harness's session view — light and dense, one collapsed line per step (reasoning, model call, program) expanding on click instead of bordered cards — plus a "compact" mode and file attachments in the composer | recorded in [CHAT-UX.md](./CHAT-UX.md). Owner decision 2026-11-07: **"compact" means context compaction** (summarize older turns into one replayable message), not a density switch; the density/style work remains a later visual slice. Attachments: project files as path references read with the PTC tools first; OS files/images only once the multimodal message format exists — **pasted screenshots landed in D-113**; the lighter transcript landed in D-114. **Context compaction landed in D-133** (header action, `ChatState.summary`, replay swap, marker row). Remaining: the project-file picker; the 2026-11-12 owner review added Markdown, the queued-message inbox and multiple conversations (D-172) | IDE chat polish, after the preview tools (D-111 landed) |
| O-019 | Log retention and tamper evidence beyond a local file: WORM storage, an HMAC-keyed chain, and external sinks (S3/Syslog/OTLP) | D-119 gives the file/stdout pipeline with a SHA-256 `seq`/`prevHash` chain and delegates WORM/retention to the deploy's log platform. Add an optional HMAC key per deployment (`FACILIS_LOG_HMAC_KEY`) and a `committed`/`rolled_back` entry for the request transaction before this is called tamper-proof | Phase 7+ |
| O-020 | SSO depth: IdP-initiated SAML, SCIM provisioning, refresh tokens/session sync, TOTP/WebAuthn as a second factor | keep SP-initiated SAML, JIT linking/provisioning and password+SSO only; each of the four is a separate contract (and 2FA needs a second credential table, not a provider flag) | Phase 7+ |

When an item is decided, add the resolving `D-0NN` and mark the row done; update
`docs/SPEC.md` if a contract changes.
