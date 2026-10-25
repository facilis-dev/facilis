# Phase 0 Headless Feasibility Spike — REPORT

Standalone spike package: `spikes/phase0/` (not a workspace member; own `pnpm-lock.yaml`).
Runs on **Node 24.22.1** + **pnpm 12.15.0**, no browser / WebContainer.

**Read this as:** what Phase 0 can prove without a browser, what it cannot, and the two
blocking findings (A16 macro-in-wrapper; spec §8.4.5 policy composition).

---

## 1. Version matrix (all exact, installed and executed)

| Package | Version | Notes |
|---|---|---|
| node | 24.22.1 | installed |
| pnpm | 12.15.0 | installed |
| nitro | **3.0.260903-beta** | latest at spike time, pinned exact (SPEC §13 risk 2) |
| vite | **8.3.5** | latest; works with nitro beta + plugin-react 6 |
| @vitejs/plugin-react | 6.1.2 | requires vite ^8 |
| react / react-dom | 19.3.1 | |
| @electric-sql/pglite | 0.5.11 | requested version |
| drizzle-orm | 0.45.4 | has `pgPolicy`, `.enableRLS()`, `getTableConfig().policies/.enableRLS` |
| vitest | 5.0.5 | |
| rolldown | 1.2.15 | used by the AST-pass prototype (`transformSync`/`parseSync` from `rolldown/utils`) |

No vite-7 fallback was needed: **vite 8.3.5 + nitro 3.0.260903-beta is a working pair.**
Nitro v3 removed auto-imports, so route files must import `defineHandler` from `"nitro"`
explicitly (this broke the first dev boot; fixed in the spike).

Install: `cd spikes/phase0 && pnpm install --ignore-workspace` (own lockfile, 58+1 pkgs).

---

## 2. Per-item results (Appendix A tickets)

| # | Ticket | Result | Evidence |
|---|---|---|---|
| A1 | Fork Vivari Studio; `pnpm dev` opens editor | **NOT TESTABLE HEADLESS** | Requires browser + WebContainer/Vivari Studio UI. |
| A2 | Strip demo templates from Studio | **NOT TESTABLE HEADLESS** | Studio UI content change. |
| A3 | "New Project" mounts local starter into preview | **NOT TESTABLE HEADLESS** | Requires Vivari VFS/WebContainer mount. |
| A4 | Starter `vite.config.ts` registers plugins; `vite dev` boots | **PASS (partial)** | `plugins: [nitro(), react()]` boots and serves client + API. `facilis()` does not exist yet (Phase 1); plugin-before-`nitro()` ordering was exercised by the AST-pass plugin (same position). |
| A5 | `nitro.config.ts` `serverDir` + `experimental.openAPI`; `/_openapi.json` returns spec | **PASS** | Dev run: `GET /_openapi.json => HTTP 200 application/json`; `paths["/api/health"]` present. `serverDir: "./server"` is required in v3 (scanning is opt-in) and worked. |
| A6 | Studio spawns `vite dev` in Vivari; preview iframe | **NOT TESTABLE HEADLESS** | Needs WebContainer process spawning + iframe. The underlying `vite dev` boot is proven headlessly (A4/A5). |
| A7 | Studio fetches `/_openapi.json` from Vite origin | **PASS (headless half)** | Fetched over HTTP from the same Vite origin that serves the React client. Studio UI half is A1-A3/A6. |
| A8 | `vivari.fs.writeFile` → client HMR + server worker reload | **NOT TESTABLE HEADLESS** | Requires Vivari kernel/VFS watcher bridge. |
| A9 | `vivari.fs.writeFiles` batch | **NOT TESTABLE HEADLESS** | Same. |
| A10 | `isomorphic-git` with `fs: vivari.fs` | **NOT TESTABLE HEADLESS** | Requires Vivari VFS fs adapter; Node fs is not the same surface. |
| A11 | PAT modal + WebCrypto encryption in OPFS; clone works | **NOT TESTABLE HEADLESS** | OPFS/WebContainer storage unavailable in Node. |
| A12 | Kill/reboot Vivari; uncommitted changes survive | **NOT TESTABLE HEADLESS** | Requires WebContainer + OPFS mirror restart. |
| A13 | PGlite boots; `SELECT 1` succeeds | **PASS** | Vitest: cold boot + `SELECT 1` = **977 ms**; also asserted fresh-session `current_setting('app.roles', true)` is NULL. |
| A14 | PGlite RLS via `current_setting('app.roles')` filters admin vs non-admin | **PASS (mechanism)** | Vitest, non-superuser role via `SET ROLE`, 12 assertions. **Spec example bug found — see §4.** Mechanism works: admin vs non-admin visibility differs exactly as the policies dictate; RESTRICTIVE variant matches the spec table. |
| A15 | `getTableConfig()` returns non-empty `policies` + `enableRLS` | **PASS** | `policies.length === 2`; names `documents_tenant_isolation`, `documents_read`; `enableRLS === true`; USING SQL contains `current_setting('app.roles', true)` and `current_setting('app.tenant_id')`, no `TO` role. |
| A16 | `defineRouteMeta` inside `defineAuthorizedHandler` emits `x-db-tables` in `/_openapi.json` | **FAIL (native); PASS (fallback prototype)** | See §3. |
| A17 | `/__facilis/manifest` stub returns `{ revision }` 200 JSON | **PASS** | Dev: `HTTP 200 application/json;charset=UTF-8` body `{"revision":"000…","generatedAt":"1970-01-01T00:00:00.000Z","stub":true}`. Production guard (404) added per §6.8/§8.5. |

Extra §14.1 items:

| Item | Result |
|---|---|
| §14.1-11 `?format=summary` manifest < 500 tokens | **NOT TESTED** — the stub has no sections/summary; needs the real manifest (Phase 1). Out of this spike's scope. |
| §14.1-12 `facilis()` + `nitro()` compose without conflict | **PARTIAL** — `facilis()` doesn't exist yet; a pre-`nitro()` plugin (the AST pass) composes and boots cleanly, so the documented plugin order `[facilis(), nitro(), react()]` is plausible but unproven with the real plugin. |

Headless *not testable* reasons are all "browser/WebContainer surface": Vivari Studio UI
(A1-A3), WebContainer process spawn + iframe (A6), Vivari VFS/OPFS (A8-A12). None of these
are de-risked by this spike; they remain Phase 0 work in a browser harness.

---

## 3. A16 verdict (highest risk): native macro-in-wrapper does **not** work

### 3.1 What was executed

- `server/utils/authorized.ts`: `defineAuthorizedHandler(config, handler)` that calls
  `defineRouteMeta({ openAPI: { description, "x-permission", "x-db-tables", "x-db-columns" } })`
  **inside the wrapper body**, then returns `defineHandler(...)`.
- `server/routes/api/health-wrapped.get.ts`: `export default defineAuthorizedHandler({...})`.
- Controls: `health.get.ts` (top-level `defineRouteMeta`) and `health-manual-meta.get.ts`
  (top-level `defineRouteMeta` + wrapper-ish handler).
- Booted `vite dev` headlessly, fetched `/_openapi.json`, then killed the server.

### 3.2 Evidence (dev, port 5283)

```
GET /_openapi.json => HTTP 200 application/json
/api/health            => {"description":"Health probe (control case: top-level defineRouteMeta macro)","tags":["facilis-spike"]}
/api/health-manual-meta=> {"description":"Manual top-level metadata probe","x-permission":"todos:read","x-db-tables":["todos"],"x-db-columns":["todos.title"]}
/api/health-wrapped    => {"tags":["API Routes"]}        <-- NO description, NO x-permission, NO x-db-tables
```

Root cause (verified in installed source, `node_modules/nitro/dist/_build/common.mjs`,
plugin `nitro:route-meta`): the scanner transforms each handler's source and only accepts a
**top-level** `ExpressionStatement` whose callee is the identifier `defineRouteMeta` with one
argument. A call inside the wrapper body (or inside `export default defineAuthorizedHandler(...)`)
is invisible to it. `defineRouteMeta` is a build-time macro with no runtime side effect, so no
other mechanism recovers the metadata.

### 3.3 Fallback prototype: framework-owned AST pass — **GO (prototype works)**

Implemented and executed:

1. `tools/facilis-openapi-ast-fallback.ts` (Vite plugin, stands in for `facilis()` when
   `FACILIS_OPENAPI_AST_FALLBACK=1`): parses every file under `server/routes/` with
   rolldown's `transformSync` + `parseSync`, finds a top-level `defineRouteMeta(...)` **or**
   a top-level/exported `defineAuthorizedHandler({...})` call, statically evaluates
   `description / permission / dbTables / dbColumns`, and exposes the map as the virtual
   module `#facilis/openapi-meta`.
2. `server/openapi-facade.ts`: fetches Nitro's generated spec via `serverFetch` and merges
   the AST metadata into each operation; served at `/_openapi.json`.
3. `nitro.config.ts` under the flag: `openAPI.route = "/_facilis/openapi.json"` (keeps Nitro's
   own generation intact, off the public path) and
   `routes: { "/_openapi.json": "./server/openapi-facade.ts" }`.

Evidence (dev, port 5292, `FACILIS_OPENAPI_AST_FALLBACK=1`):

```
/_openapi.json => HTTP 200
/api/health-wrapped => {"description":"Wrapper-emitted metadata probe","x-permission":"todos:read","x-db-tables":["todos"],"x-db-columns":["todos.title","todos.ownerId"]}
/api/health-manual-meta => {"description":"Manual top-level metadata probe",...}
/_facilis/openapi.json (internal) => HTTP 200
```

**Verdict: A16 native = FAIL; A16 with AST-pass fallback = PASS. Phase 0 should not be
declared green on A16 as specified — adopt the fallback design as part of Phase 1's
`@facilis/nitro` work.** This matches SPEC §13 risk 3 and §12's "fall back to a
framework-owned AST pass" instruction.

Also tested and rejected as a cheaper alternative: intercepting Nitro's internal
`<handler>?meta` modules from a user Vite plugin (resolveId/load hooks). In dev, Nitro's
internal route-meta plugins handle those ids before user plugins, and the hooks are never
reached. The facade + AST pass is the workable shape.

Fallback limitations to carry into Phase 1 (all acceptable for Phase 0):
- Only statically analysable configs (object literals); same limitation as Nitro's scanner.
  `dbTables` imported from another module would not be seen — a lint rule/review check is needed.
- The AST virtual module is generated per load; **route-file edits do not currently
  invalidate it**. Phase 1 must add file watching/invalidation (Vite module graph) so HMR
  route edits update the manifest/OpenAPI.
- Moving Nitro's built-in spec to an internal route is a spec delta worth recording in
  §6.9; alternatively `@facilis/nitro` can generate a physical route + spec during scan.

---

## 4. A14 finding: SPEC §8.4.5 example policies do **not** produce the documented table

PGlite RLS itself works, but the policy composition in SPEC §8.4.5 is wrong under Postgres
permissive-policy semantics (multiple permissive policies for the same command are **OR-ed**;
only `AS RESTRICTIVE` policies are AND-ed). Executed with the spec's verbatim policies over a
fixture of 4 documents (3 in tenant T, 1 in tenant U):

| Caller | Spec table says | Actual with verbatim policies |
|---|---|---|
| manager, tenant T, owns 2 | sees only their docs | **sees all 3 tenant-T docs** (tenant policy is permissive → OR) |
| admin, tenant T | sees all docs in tenant T | **sees all 4 docs, including tenant U** (admin clause is OR-ed, tenant-agnostic) |

Fix verified in the same suite: `CREATE POLICY documents_tenant_isolation ... AS RESTRICTIVE`
(the `documents_read` permissive policy stays). With that change the table holds exactly:

```
admin (tenant T)        => ["t-doc-1","t-doc-2","t-doc-3"]
admin (tenant U)        => ["u-doc-1"]
manager (tenant T, owns 2) => ["t-doc-1","t-doc-2"]
user (tenant T, owns none) => []
```

Recommendation: update SPEC §8.4.5 to mark the tenant-isolation policy `AS RESTRICTIVE`
(or fold the tenant predicate into every policy), and have `@facilis/db`'s RLS auto-generator
emit it that way.

Second A14 nuance: `current_setting('app.roles', true)` is NULL only before the GUC is first
set. After `RESET app.roles` it becomes `''`, and `''::jsonb` raises
`invalid input syntax for type json` — a per-request middleware that clears GUCs can therefore
500 a policy evaluation. Safer policy expression (verified):
`nullif(current_setting('app.roles', true), '')::jsonb ? 'admin'`. Recommend standardising
this in `@facilis/db`.

Also verified: PGlite's connection is a superuser and bypasses RLS (even with FORCE), so tests
(and any app-level guarantee) must evaluate policies under a non-superuser role via `SET ROLE`.
The policies themselves still use only app GUCs, no Postgres roles — SPEC §8.4.5 honoured.

---

## 5. Commands run (reproducible)

```bash
cd spikes/phase0
pnpm install --ignore-workspace        # own lockfile, exact pins
pnpm build                             # vite build (client + nitro env) => exit 0
pnpm exec vitest run                   # 2 files, 14 tests passed
./scripts/verify-dev.sh                # boots vite dev headless in both modes, curls endpoints
```

Individual dev runs used for evidence above:
`pnpm exec vite dev --host 127.0.0.1 --port <p> --strictPort` (default mode: 5283;
`FACILIS_OPENAPI_AST_FALLBACK=1`: 5292), polled with curl until ready, then killed.
Environment note: this sandbox exports `PORT=8080` (already occupied) and Nitro inherits it — override `PORT` for headless runs. Vite's default `localhost` binding resolves to IPv6 `::1` here (the listener is on `::1`, not `127.0.0.1`), so either pass `--host 127.0.0.1` (as above) or probe `http://localhost:<port>`. Both behaviours were independently confirmed by the Lead after this report was drafted.

Key outputs already quoted in §2-§4. Additional:
- `pnpm build` (default mode) emits `.output/public/*` + `.output/server/_routes/api/health.mjs`,
  `.../__facilis/manifest.mjs`, `.output/nitro.json` — build does **not** include
  `/_openapi.json` because Nitro's OpenAPI is dev-only unless `openAPI.production` is set
  (matches SPEC's dev-only contract).
- `pnpm exec vitest run`: `Test Files 2 passed (2) | Tests 14 passed (14)`.

**Verification status / caveats:** the composite `scripts/verify-dev.sh` batch run was
timed out by the harness at 120 s after both dev boots had previously been verified
individually (evidence above). `FACILIS_OPENAPI_AST_FALLBACK=1 pnpm build` and the
production-server smoke (`.output/server/index.mjs`) were **not re-verified** after the
dev-only guards were added; treat those as unverified follow-ups, not failures.

---

## 6. Files in this spike

| Path | Purpose |
|---|---|
| `vite.config.ts` | `nitro()` + `@vitejs/plugin-react`; AST-fallback plugin only when `FACILIS_OPENAPI_AST_FALLBACK=1` |
| `nitro.config.ts` | `serverDir: "./server"`, `experimental.openAPI: true`; under fallback flag moves built-in spec + registers facade |
| `server/routes/api/health.get.ts` | A5 control route with top-level `defineRouteMeta` |
| `server/routes/api/health-wrapped.get.ts` | A16 probe (`export default defineAuthorizedHandler({...})`) |
| `server/routes/api/health-manual-meta.get.ts` | A16 control (top-level meta + wrapper impl) |
| `server/utils/authorized.ts` | Prototype `defineAuthorizedHandler` (emits meta inside wrapper) |
| `server/routes/__facilis/manifest.get.ts` | A17 stub (404 in production) |
| `server/openapi-facade.ts` | Fallback `/_openapi.json` that merges AST metadata |
| `tools/facilis-openapi-ast-fallback.ts` | Framework-owned AST pass prototype |
| `tests/pglite-rls.test.ts` | A13 + A14 (spec-verbatim vs RESTRICTIVE, GUC reset nuance) |
| `tests/drizzle-policy.test.ts` | A15 |
| `scripts/verify-dev.sh` | Repeatable headless dev verification |
| `vitest.config.ts` | Serial files for deterministic PGlite teardown |

---

## 7. Go / No-Go recommendation

**GO for Phase 0 → Phase 1, conditional on two spec/framework changes:**

1. **A16 is a real FAIL for the spec's current design.** Do not write `defineAuthorizedHandler`
   assuming Nitro's scanner will find an in-wrapper `defineRouteMeta`. Adopt the AST-pass +
   facade (or generated-route) fallback in `@facilis/nitro` in Phase 1, and update SPEC §6.9/§13.
   The prototype demonstrates it is achievable with current pinned versions; it is not a NO-GO.
2. **SPEC §8.4.5 must change** to `AS RESTRICTIVE` tenant isolation (plus `nullif(...)` GUC
   handling) before RLS auto-generation is implemented, or the documented security table will
   not hold.

Everything else probed headlessly is green: Nitro v3 as a Vite plugin (build + dev, one
origin), `/_openapi.json` with route metadata and x-* extensions, manifest stub, PGlite boot,
row-level filtering by app-role GUCs, and drizzle `getTableConfig().policies`/`enableRLS`.
The remaining Phase 0 tickets (A1-A3, A6, A8-A12, plus §14.1-11) are browser/WebContainer
items and **cannot** be cleared by a headless spike; they still require a Vivari harness.
