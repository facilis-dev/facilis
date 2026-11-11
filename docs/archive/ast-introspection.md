# AST-based introspection for Facilis — feasibility analysis

Status: **historical feasibility analysis, 2026-11-04**. This is the evidence and options
analysis that led to D-092; the implemented contract is
[ast-dsl-contract.md](<../findings/ast-dsl-contract.md>) and the cutover is D-093. Paths to
scanners below describe the pre-cutover tree and are kept as the record of what was replaced.

**Direction chosen in review (2026-11-04):** interpret the framework's declarative DSL
ourselves, with **zero build-time execution**; runtime endpoints remain only for live state
(applied catalog, drift, boot). The concrete contract — constructs to force, static subset,
fact model, diagnostics, graph model and fixture matrix — is in
[ast-dsl-contract.md](<../findings/ast-dsl-contract.md>). This document remains the
feasibility evidence and the options analysis behind that choice.

The question: today the Studio (and the AI layer) learn about the schema and the API surface
by calling runtime endpoints served by the generated project. That dependency breaks when the
project changes. Is static AST analysis — with `oxc-parser` — a viable alternative, and
should we introduce annotations or force particular functions so critical points are easier to
detect?

## 0. Verdict

**The static half is feasible and worth doing; the runtime half is not replaceable.** Move
discovery and shape (routes, declared schema, config, i18n, imports, migrations, client
consumers) to one AST-based fact model. Keep a runtime oracle for values only execution can
produce (the live PostgreSQL catalog, executed module values, runtime boot state, exact
Zod/Drizzle behaviour).

- **Parser:** `oxc-parser` is a good fit. It parses TS/TSX directly, keeps comments,
  ranges and ESM information, and its browser entry (a 1.5 MB wasm32-wasip1 module, 513 KB
  gzip) was **proven end-to-end in headless Chrome from a Vite 8 build**: cold 49–54 ms, worker
  first parse 1.1 ms; 813 real repo TS files parsed in 327 ms (0.40 ms/file) through the WASI
  binding. The WebContainer path is *not* proven yet, so the generated project keeps its
  current rolldown/oxc 0.155 pass while the browser uses oxc-parser (see §4.3).
- **One analyzer, two adapters:** the fact model and rule logic are parser-agnostic; the VM
  keeps rolldown's oxc 0.155, the browser/host use oxc-parser, and the AST contract is
  normalized to the repo's structural node shape. The two `@oxc-project/types` versions have
  byte-identical type definitions today.
- **Architecture:** one new browser-safe package (working name `@facilis/analyze`) with an
  injected parser, consumed by the IDE, the AI validator, the Nitro plugin and the release
  preview. The runtime endpoints stay, but become thin transports over the same facts plus
  the live data only they can supply.
- **"Everything is code" ≠ "the AST can evaluate it".** The invariant says the truth is
  *authored* in the repo; it does not make the value of an expression syntactically evident.
  The real boundary is **syntax vs evaluation vs state** (§3.1): what AST cannot derive is not
  automatically "endpoint-only" — build-time evaluation of the project's own modules (no DB) is
  the faithful middle layer, and the runtime endpoint remains only for state.
- **Annotations:** **no** free-form annotations as a second source of truth. Keep the forced
  helper functions we already have (`defineAuthorizedHandler`, `defineConfig`, `t()`), add a
  bounded static subset with an explicit "unknown" channel, extend the helpers where they
  enforce security bindings, and gate statically-analysable metadata in lint/CI. That is what
  "force particular functions" should mean. Annotations are acceptable only for line-scoped
  exceptions, never for permissions, tables, columns or RLS.

The important reframing: AST does not make metadata "never break". It makes the *source of
truth* cheap to read and makes *failure explicit*. Code changes can still change shape; the
analyzer must report `unknown`, not guess, and the framework must keep runtime enforcement of
the invariants.

## 1. What "endpoint introspection" means today

The generated project runs Vite + Nitro in the WebContainer. Nitro exposes six dev surfaces
and three virtual modules; the Studio and the AI layer read the JSON.

| # | Surface | Registered | Producer | Static vs executed vs live |
|---|---|---|---|---|
| 1 | `GET /__facilis/manifest` (`packages/nitro/src/routes/manifest.get.ts:35`) | dev only (`module.ts:149`) | `@facilis/nitro` | mixed: config from executed module, routes from AST pass, schema from executed Drizzle namespace, i18n from fs |
| 2 | `GET /__facilis/manifest/revision` | dev only | `@facilis/nitro` | fs bytes + AST metadata (`runtime/revision-service.ts`) |
| 3 | `GET /__facilis/health` | dev only | `@facilis/nitro` | boot timestamp + revision |
| 4 | `GET /__facilis/dev/schema` | dev only | `@facilis/nitro` + `@facilis/db` | code = executed `getTableConfig`; live = `pg_catalog`; drift = pure diff |
| 5 | `GET /_openapi.json` facade | dev unless `openAPI.production` | `@facilis/nitro` | Nitro's generated spec (executes routes) + AST metadata |
| 6 | `GET /_facilis/openapi.json` | internal | Nitro | executed route modules |
| 7 | virtual `#facilis/config` | server | `@facilis/nitro` | executes `facilis.config.ts` |
| 8 | virtual `#facilis/db-schema` | server | `@facilis/nitro` | imports/executes `db/schema.ts` (Drizzle definitions) |
| 9 | virtual `#facilis/openapi-meta` | Vite plugin | `@facilis/nitro` AST pass | static scan of `server/routes/**` |

SPEC §6.3/§11.4 also names `POST /__facilis/dev/query`; there was no route when this audit was
written. It now exists (D-097), together with `POST /__facilis/dev/view`, and both are dev-only
reads/writes on the same origin allowlist as `dev/schema`.

Consumers and what degrades when a surface is unreachable:

| Consumer | Reads | Failure behaviour today | Feature degraded |
|---|---|---|---|
| Data Explorer (`ide/src/components/ide/DataExplorerPanel.tsx:40`) | `dev/schema` + manifest routes | "run the project" / error card; the 2 s revision poll can recover, and the request is now kernel-mediated so a popped-out preview works (D-097) | code↔live table, RLS badges, drift, "used by" |
| Query console (`ide/src/components/ide/DataQueryPanel.tsx`) | `dev/query` + `dev/view` | code/error card; run again to retry | SQL preview and create-view (D-097) |
| API Flow (`ApiFlowPanel.tsx:60`) | `/_openapi.json` | unreachable/error, or "enable openAPI" when the facade is empty | graph, inspector, route→source jump |
| Release code↔live card | `dev/schema` | unreachable | fourth lens only |
| Release API diff (`release-preview-load.ts:136`) | manifest routes | silently empty (`:139`) | permissions/tables in the API diff |
| AI chat (`ide/src/ai/chat-context.ts:38`) | full manifest every turn | prompt line becomes "(unavailable)" | model loses routes/schema/blocks |
| AI patch validator (`ide/src/ai/patch-context.ts:41`) | manifest, 3 s bound | falls back to sources | rules 4/5/6 inverse checks, rule 7, framework tables |
| applyPatch (`apply-patch.ts:112`) | revision | null | can't tell whether the manifest changed |
| headless/smoke gates | several endpoints | hard failure | acceptance gates assert zero warnings |

The point is not that these endpoints are badly written. They are the only way to observe
executed code from the browser, and the spec asks for exactly that. The problem is that they
are also the only way to observe *declared* code, which does not need execution at all.

## 2. What breaks when the code changes

Concrete failures found in the current tree (line references are to HEAD):

1. **A route the scanner cannot see is served but invisible.** The AST pass only accepts a
   direct `export default defineAuthorizedHandler(...)`; `const h = defineAuthorizedHandler(...);
   export default h` yields `undefined` and the scanner silently skips the file
   (`packages/nitro/src/ast/extract-metadata.ts:49-91`,
   `packages/nitro/src/ast/scanner.ts:40-41`). Nitro still serves the route, so the manifest,
   OpenAPI, Explorer badges and AI context all miss it. The patch validator explicitly accepts
   the variable form (`packages/ai/src/rules/routes-security.ts:20-27`), so the framework
   green-lights code its own introspection cannot see.
2. **Unresolved `dbTables` is published as "no tables".** The extractor marks the field
   unresolved and the facade omits it, but the manifest builder sets `dbTables: []`
   (`scanner.ts:47`) and `RouteMeta` has no unresolved field (`packages/core/src/manifest.ts:49`).
   "Unknown" is indistinguishable from the explicit empty array the spec requires.
3. **Unresolved `permission` is treated more carefully than the rest** (`security: "unknown"`,
   `runtime/manifest-data.ts:90`), but the same tri-state is not propagated to tables/columns.
4. **The route inventory can diverge from Nitro's router.** The AST reimplements the file
   router (`ast/route-path.ts`): only `get/post/put/patch/delete` suffixes, a missing suffix
   defaults to GET, and `server/api` is not scanned. Nitro's own scanner accepts more methods
   and treats a method-less file differently. Metadata that does not match a native path is
   silently dropped by the facade (`packages/nitro/src/facade.ts:49-60`).
5. **The revision can change before the payload does.** The revision hashes source bytes, but
   the schema section is the executed Drizzle namespace bound to the process-memoized bootstrap
   (`runtime/bootstrap.ts:30-42`). Editing `db/schema.ts` bumps the revision against the old
   schema until the Nitro worker reloads; a newly generated migration is not applied until a
   restart. The Entity Explorer then shows drift for a migration that exists.
6. **Declared schema is gated on a database that is never queried.** `getManifestSnapshot`
   awaits `getBootstrap()` and without a booted DB returns a partial manifest with the schema
   section removed (`runtime/manifest-service.ts:29-34,60-83`), even though
   `schemaSnapshot(db)` only reads the Drizzle namespace.
7. **The text parsers are fragile by construction.** `ide/src/facilis/release-schema.ts` is a
   tolerant regex scan of `db/schema.ts`; imported tables, spread columns, helper factories
   and non-literal policy names are invisible. `packages/ai/src/{scan,config-facts,schema-facts}.ts`
   are a second scan, and `ide/src/facilis/api-flow-consumers.ts` a third for imports/URLs.
   Four parsers of the same truth already disagree.
8. **The AI validator's textual rules are spoofable.** `maskSource` masks comments but not
   strings; a route file containing
   `const hint = "export default defineAuthorizedHandler( defineAuthorizedHandler("` and
   `const label = "dbTables:"` plus a raw exported handler passes rules 2 and 3. This was
   verified with a throwaway probe against the current matchers. Rule 2 is the only guard
   against an unguarded route in an AI patch, so this is a security-relevant gap, not a
   cosmetic one.
9. **`dbColumns` has two naming domains.** Routes declare Drizzle property keys
   (`todos.dueDate` in `examples/todo-app/server/routes/api/todos/index.get.ts:11`), while the
   release cross-check compares SQL column names from migration statements
   (`packages/core/src/release-breaking.ts:60-69`). References to camelCase properties can
   never lift a drop to "breaking". SPEC §7.3 does not pin the domain.
10. **Blocks can never satisfy rule 7.** The only fact source is the manifest's `blocks`
    section, which the runtime never populates; every `@facilis/blocks` import therefore fails
    in the validator (`packages/ai/src/rules/blocks.ts`). Phase 5 is now retired and the package
    deleted (D-131), so the rule is permanently a guard against a supply chain that does not exist.
11. **Boot timing is not retried by panels.** A first request during boot renders the error
    state; the 2 s revision poll only refreshes after a successful revision response, so the
    panel can stay empty until a manual refresh (the spec's "retry with backoff" is not
    implemented).

Classification: 1–3 and 8–9 are correctness/security; 4–6 and 11 are UX/correctness-adjacent;
7 and 10 are accepted limits that have become user-visible. None of them is fixed by parsing
"more tolerantly"; they are fixed by one fact model with explicit unknowns and a runtime
oracle.

## 3. What an AST layer can and cannot supply

| Fact | AST-only? | Needs | Recommendation |
|---|---|---|---|
| Route method + path | yes | filename convention matched to Nitro's real router | static model, tested against Nitro's scanner as oracle |
| Wrapper, permission, dbTables, dbColumns, description | yes for literals; more with a bounded resolver | object literal, same-file consts, 1-hop project imports | static model; unknown is explicit, never `[]` |
| Zod body/query/params presence | yes | syntax of the config property | static presence check |
| Zod request/response JSON Schema | no | executing Zod | runtime, only where an API document really needs it |
| Config roles/permissions/defaults | yes for literals; defaults from shared core schema | literal + `facilisConfigSchema` (browser-safe) | static, reusing core validation/defaults |
| Table/column names, scope columns, RLS marker, policy helper usage | mostly | bounded interpretation of the Drizzle call chain | static for display/gate; exact values from runtime or drizzle snapshot |
| Exact column type/default/PK/unique/FK rendering | no (parity) | `getTableConfig` + `PgDialect` | build-time module evaluation, runtime code snapshot, or drizzle-kit `meta/*_snapshot.json` |
| Policy SQL / normalized predicates | no | Postgres + Drizzle | runtime |
| Applied migrations, live catalog, drift | no | a running database | `/__facilis/dev/schema` stays |
| i18n keys + catalogs | keys yes, catalogs yes | AST for `t("...")`; JSON files for catalogs | static |
| Block manifests | yes | package discovery + JSON files | static, plus a producer (today none) |
| Imports / tsconfig aliases / allowlist | yes | AST imports + project metadata | static; better than the regex |
| Client consumers of routes | yes | AST for literals/imports | static, replaces the regex |
| Boot health / warnings | no | runtime | endpoint |
| Framework versions | mostly | package.json / installed package files | static with endpoint fallback |

A fact is **not derivable from AST alone** when it is the *value produced by an expression* or
the *state of an execution*, rather than the shape of the syntax. That is the real boundary — not
"in the repo" vs "not in the repo". Project config, schema and routes are all code; the AST is a
representation of their syntax, not of their semantics. §3.1 makes that distinction explicit.

### 3.1 "Everything is code" is about authorship, not about evaluation

Facilis' invariant is that config, schema, routes and permissions are code in the repo,
reviewable and diffable — not hidden in a database, a UI or a vendor console. That invariant is
important and should stay. It does **not** imply that an AST can answer every question about
that code, because three different things are being conflated:

1. **Syntax — what the AST sees.** Declarations, calls, literals, properties, imports.
   `pgTable("todos", { id: uuid("id").primaryKey().defaultRandom() })` is fully visible: a call,
   a string literal name, an object whose `id` value is a call chain.
2. **Evaluation — what the code produces.** The SQL type (`uuid`), the primary-key flag, the
   default (`gen_random_uuid()`), the policy SQL, the resolved config defaults, Zod → JSON
   Schema. These are results of executing drizzle-orm, `PgDialect`, Zod and `defineConfig`. The
   AST sees the *call*, not the *result*.
3. **State — what the running system is.** Applied migrations, the actual catalog, RLS enabled
   in the database, boot warnings. This is not in the repo at all; it is the projection of
   executing the code against a database.

Concrete examples:

- `const tableName = process.env.TABLE ?? "todos"; pgTable(tableName, columns())` — the AST sees
  identifiers; the table name and the columns are values produced by evaluation, possibly
  different per environment.
- `export { users } from "@facilis/auth"` — the AST sees the re-export; the table definition
  lives in a package, possibly as built output. Parsing into `node_modules` is possible;
  evaluating the package is more faithful.
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in a migration is code; whether the running
  database has it is state.
- `z.object({ title: z.string() })` is code; the JSON Schema is what executing Zod produces.

So "everything is code" says **where the truth is authored**, not **how cheaply it can be
recovered**. There are exactly three ways to close the gap:

- **Narrow the authoring contract** so the value is syntactically evident — literals, forced
  helpers, a documented static subset. This is the AST-only path; it is a real design choice,
  not a parser limitation.
- **Evaluate at build/dev time** — execute the project's own modules in Node without a database,
  and ship the result as an artifact. Faithful for Drizzle/config/Zod; Node-only, so not for an
  old git ref in the browser.
- **Observe at runtime** — the current endpoints, for state and for anything not evaluated at
  build time.

That is the correct decision axis: not "AST vs endpoint", but **how much of the contract we make
statically evident, how much we evaluate at build time, and how much is genuinely state**.

## 4. Parser feasibility: oxc-parser

### 4.1 Measured

All numbers from probes in this session (Node 24 / Chromium, `oxc-parser@0.157.0`):

| Measurement | Result |
|---|---|
| Native parse, 600 small files | 8 ms (0.01 ms/file) |
| WASI parse, 813 real repo TS/TSX files (2.6 MB) | 327 ms total, **0.40 ms/file**, ~7.9 MB/s |
| WASI parse, 201 synthetic route-like files (887 KB) | 109.8 ms median, 0.546 ms/file, 7.9 MB/s |
| WASI cold load (`require` of the binding) | 32 ms |
| `parser.wasm32-wasip1.wasm` | 1,529,322 bytes (~1.46 MiB; **513 KB gzip**) |
| Browser loader `parser.wasip1-browser.js` | 56 KB |
| Real Vite 8.3.5 browser build | main JS 254 KB (61 KB gzip) + worker chunk 255 KB; wasm 1.53 MB (513 KB gzip); build ~150 ms |
| Real headless-Chrome load (repo's own Chromium) | module start → parsed **49–54 ms**; first worker parse **1.1 ms**; Vite dev mode also works |
| wasm linear memory | `new WebAssembly.Memory({ initial: 4000, maximum: 65536 })` = **250 MiB initial reservation per instance** |
| TS/TSX/JSX | parsed directly, no transform needed |
| Comments / source ranges | preserved; `preserveParens` default true, `range` optional |
| Error recovery | returns `errors[]` (span labels, codeframe) and a partial program |
| ESM information | `result.module`: `staticImports`, `staticExports`, dynamic imports, `import.meta` — no walk needed for resolution |
| API | `parseSync(filename, source, options)` / async `parse`; `lang`, `sourceType`, `astType`, `range`, `preserveParens`, `showSemanticErrors` |
| Browser traversal | the wasm entry exports `visitorKeys` (and `parse`) but **not `Visitor`**; the Node-only visitor is not available, so use a small walker over `visitorKeys` |
| Browser entry | package `browser` condition → `src-js/wasm.js` → separate `@oxc-parser/binding-wasm32-wasip1`, top-level `await fetch(new URL("./parser.wasm32-wasip1.wasm", import.meta.url))` |
| Alternative loader | `@oxc-parser/binding-wasm32-wasip1/workerd` exports `instantiate(wasmInput)` (no TLA; caller supplies a `WebAssembly.Module`) |
| WebContainer | package ships `src-js/webcontainer-fallback.cjs`; upstream "auto download wasm binding on WebContainer" (PR #10049) does a **runtime `pnpm i`** into `/tmp` |
| Node/CI | native optional bindings per platform |

These numbers make a full-project parse affordable: a generated project of 200–500 route /
schema files costs roughly 0.1–0.3 s in a worker, and the AST is transient. The 250 MiB
memory reservation is per wasm instance (main thread and worker each), not per parse; that is
the number to check in the WebContainer, where the kernel is already memory-constrained
(`docs/DEV.md`).

### 4.2 Browser integration: proven, with three hard requirements

The headless-Chrome probe is the important result: a Vite 8.3.5 page and a module worker both
loaded oxc-parser, parsed real TS, and preserved comments/ranges/`as const`. Three
integration requirements were discovered empirically, not from docs:

1. **One emnapi, pinned.** A stock install throws `TypeError: this.bridge.setLastError is not
   a function` in the browser: `@napi-rs/wasm-runtime@1.2.7` auto-installs `@emnapi/core
   1.11.3`, while the wasm binding nests `2.0.0-alpha.6`. Pin a single `@emnapi/core` /
   `@emnapi/runtime` pair (alpha.6, beta.2 or beta.3 all passed). The generated project
   already overrides beta.2; the **IDE host build needs the same pin**.
2. **Vite worker format `es`.** The default `iife` worker fails the build with
   `[INVALID_TLA_FORMAT] Module format "iife" does not support top-level await`. Set
   `worker: { format: "es" }`.
3. **Worker-ready handshake.** Messages posted to the TLA module worker before evaluation
   finishes are dropped in Chrome. The worker must post a ready message and the host must
   wait for it (probe: ready 47.5 ms, round trip 49.5 ms).

Additionally: lazy-load the worker and keep the parser out of the initial bundle; the Studio
is already COOP/COEP isolated (`ide/vite.config.ts`), so wasm and cross-origin worker assets
are available, but the production CSP (`wasm-unsafe-eval`) is still to verify. Measure the
250 MiB reservation on the target machines.

### 4.3 Node / WebContainer: keep the current parser for now

The generated project's Node runtime already runs **oxc 0.155 through `rolldown/utils`**
(`@facilis/nitro`'s AST pass and `@facilis/ai/node`). Do **not** add oxc-parser to the VM as a
new dependency yet: its WebContainer path relies on an upstream best-effort fallback that
`pnpm install`s the WASI binding at runtime into `/tmp` and on `node:wasi` support inside the
WebContainer, and neither is verified here. The generated project would also pay another
install, another wasm asset and another emnapi pin.

So the first version of a shared analyzer uses **two parser adapters over one normalized
AST/contract**: rolldown/oxc 0.155 in the VM, oxc-parser (wasm) in the browser and (native) in
host Node/CI. The repo already defines its own structural `AstNode` helpers
(`packages/nitro/src/ast/ast.ts`), which is the right normalization boundary. If a later spike
proves the oxc-parser WASI path inside the VM, the VM adapter can move and the second parser
can disappear.

Also worth fixing while there: the current scanner transforms TS first "because `parseSync`
parses JS only" (`packages/nitro/src/ast/scanner.ts:83-89`). A probe shows rolldown 1.2.15's
`parseSync` parses TS/TSX directly (`as const` → `TSAsExpression`), and `@facilis/ai/node`
already parses TS directly, so that transform step (and its comment) is likely unnecessary.

### 4.4 Version alignment

- `rolldown@1.2.15` (pinned in `packages/nitro/package.json:32`,
  `packages/ai/package.json:28`) depends on `@oxc-project/types@0.155.0` and its own
  `oxc-parser@0.155.0` devDependency. The VM parser is therefore **oxc 0.155**; the browser
  candidate is **0.157**.
- The `@oxc-project/types` 0.155.0 and 0.157.0 `types.d.ts` files are byte-identical, so the
  AST shape is compatible today; drift is behavioural (new syntax support), not structural.
- `rolldown@1.2.16` is the upstream fix generation: types 0.156.0, `oxc-parser 0.156.0`,
  emnapi 2.0.0-beta.2 and `@napi-rs/wasm-runtime 1.2.6` — the same axis as the
  `docs/DEV.md` Vite 8 WASI fix. If the browser adopts **oxc-parser 0.156.0** (the wasi
  binding exists), both sides are one oxc generation.
- Recommendation: adopt 0.156.0 in the browser or pin 0.157 and rely on the identical types,
  then **bump rolldown and oxc-parser together**. Two `@oxc-project/types` copies in the
  lockfile are harmless because the code consumes its own `AstNode` shape.

### 4.5 Alternatives

| Option | Browser | TS | AST quality | Main issue |
|---|---|---|---|---|
| **oxc-parser** | WASI entry, proven in Chrome | direct | ESTree / TS-ESTree, comments, ranges, ESM info | emnapi pin, worker format/handshake, 250 MiB reservation |
| `rolldown/utils` (today) | no | direct in 1.2.15 (the transform step is unnecessary) | oxc 0.155 AST | Node/VM only, devDependency, second oxc generation |
| Monaco TS worker | already loaded | TS 5.9.3 services | **no AST/parse API**; language-service protocol only | can't be the analyzer |
| TypeScript 7 native port (repo pin) | no | yes | remote handles via a process-based unstable API | Node-only; D-084's rejection stands |
| `@babel/parser` 8.1.0 | yes (pure JS) | plugin | good, comments attached; Babel AST (normalization needed) | 0.259 ms/file, 616 KB unpacked; no ESM summary |
| SWC wasm | yes | yes | good | ~18 MB unpacked; another engine |
| tree-sitter (web) | yes | two grammars | CST, no ESM summary | ~2.9 MB grammars; semantic introspection is harder |
| Biome wasm | yes | yes | format/lint, **no parse API** | ~65 MB unpacked; not viable |
| es-module-lexer | yes | n/a | imports/exports only | complementary, not an AST |
| regex/text scans (today) | yes | no | none | fragile and spoofable (see §2.8) |

Verdict: **oxc-parser for browser and host Node/CI, rolldown's oxc for the WebContainer until
proven otherwise, behind one normalized AST contract.** That is feasible today and leaves a
single-engine future open.

## 5. Recommended architecture

### 5.1 One fact package, layered producers

Create `@facilis/analyze` (name TBD; it must not import `@facilis/db` or `@facilis/auth`, even
type-only — D-086 shows how that pulls Node types into the browser program):

```
@facilis/analyze            pure types + orchestration, zero runtime deps
@facilis/analyze/rolldown   VM adapter over rolldown/utils (oxc 0.155, today)
@facilis/analyze/oxc        browser wasm / host native adapter (oxc-parser)
@facilis/analyze/evaluate   Node-only build-time evaluation of project modules (no DB)
```

The `evaluate` adapter is the answer to "but everything is code": it executes the project's own
modules at build/dev time (Drizzle schema, config) so their *values* are available without a
database. It is optional: without it, the analyzer falls back to the documented static subset
and reports unknown.

Contract:

```ts
interface AnalyzeInput {
  files: ReadonlyMap<string, string>;   // project-relative path -> source
  packages?: Readonly<Record<string, string>>; // dependency versions
  aliases?: readonly ImportAlias[];
  parser: Parser;                       // injected: parse(filename, source)
}
interface Analysis {
  revision: string;                     // hash of inputs, same scheme as manifest
  routes: RouteFact[];                  // each field: value | undefined + unresolved[]
  schema: SchemaDeclFact[];             // names/columns/scope/RLS; exact SQL only after evaluation
  config: ConfigFact;                   // parsed literal + resolved via core schema
  locales: Readonly<Record<string, Record<string, string>>>;
  blocks: BlockFact[];
  imports: ImportFact[];
  warnings: AnalysisWarning[];          // sourceFile, line, code
}
```

Producers, in order of preference:

1. **Static analyzer** — the AST facts above. No project code is executed.
2. **Build-time evaluator** — the project's own modules executed in Node at build/dev time,
   without a DB: exact Drizzle schema values, resolved config, generated artifacts. This is
   still "code as the source of truth"; it is a build step, not a request.
3. **Runtime oracle** — the existing manifest/OpenAPI/schema endpoints, still built by Nitro
   from executed code. In dev, compare the layers and publish differences as warnings.
4. **Live data** — `/__facilis/dev/schema` (catalog/drift) and anything else only the database
   can answer.

The analyzer must be able to run on a plain file map (VFS snapshot, git ref, patch overlay,
test fixture). That makes it usable by the IDE, the AI validator, the Release Preview and CI
without a dev server.

### 5.2 Consumers

- **IDE panels:** run the analyzer in a worker on the VFS snapshot; render immediately, then
  enrich with live data when the endpoint answers. Data Explorer shows the declared half while
  the DB boots; the API Flow was removed (D-095) in favour of the AST project graph; Release
  Preview reads the ref's schema through the same facts (release-schema.ts is a mapping;
  release-routes.ts keeps file-router method+path because a ref has no manifest).
- **AI validator:** replace `packages/ai/src/{scan,config-facts,schema-facts}.ts` with the
  analyzer; rules 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15 read AST facts. This also closes the
  string-literal bypass and lets the validator check *existing* routes, not only patched ones.
- **Nitro plugin:** `scanRouteMetadata` becomes a thin adapter over the analyzer; the facade
  builds its operation list from the static model instead of requiring Nitro's native spec.
  The runtime manifest still contributes executed values and the live schema.
- **CI/lint:** a `facilis:analyze` gate fails a change whose security metadata is not
  statically resolvable, so the analyzer cannot silently degrade.

### 5.3 Transport and revision

- Keep `/__facilis/manifest` and `/__facilis/dev/schema` for runtime/live data and external
  tooling. Rebuild the static sections from the analyzer so the endpoint and the IDE cannot
  disagree.
- Optionally add `GET /__facilis/analysis` (dev-only, origin-locked) that serves the static
  facts with the same revision scheme. Do not create a second revision: one writer (the Vite
  plugin) and one hash, or consumers will mix revisions.
- Phase the authority: first the analyzer is the offline fallback and the parity oracle; then
  it becomes the primary source for routes/config/i18n/blocks; runtime remains the oracle for
  executed values and the live DB.

### 5.4 Rollout

0. **Spike** (AGENTS.md rule): prove the browser build, the parity on `examples/todo-app`, and
   the route-inventory oracle. See §8.
1. Extract the fact model and the parser adapters; move the Nitro AST pass onto it; keep
   the endpoints.
2. Fix the route model: accept every exported form, match Nitro's router, scan `server/api`,
   make unresolved explicit. Gate it.
3. Add the schema/config/i18n/block facts; delete the text parsers after parity tests.
4. Move the AI validator onto the facts; add the existing-routes check.
5. Move IDE panels to the local analyzer (worker), keeping endpoints as live enrichment.
6. Make the runtime manifest and the static analysis compare themselves in dev; surface drift
   as warnings. Amend SPEC/DECISIONS.

## 6. Annotations vs forced functions

The question was: "do we introduce annotations or force particular functions so critical
points are easier to detect?" The answer is **force functions, but only the bindings; infer the
rest; never annotate security facts.**

### 6.1 Why not annotations

- **Second source of truth.** `defineAuthorizedHandler` config is already the runtime
  declaration for permission/tables. A JSDoc tag or a sidecar repeats it; when the handler is
  edited, an annotation can silently disagree. The existing security model says the wrapper is
  the enforcement point; the analysis should read that point.
- **Spoofable and forgettable.** The AI validator failure above is exactly a text-trust bug.
  An annotation is text. An omitted annotation must fail closed, which means annotations do not
  reduce the work; they add a new failure mode.
- **No type/runtime check.** JSDoc is not checked against the handler config unless we write
  another validator. A forced helper is checked by TypeScript and by the runtime.
- **Review burden.** Reviewers would have to compare annotation and code on every route.

### 6.2 What to force (and what not)

| Critical point | Recommendation | Why |
|---|---|---|
| Route wrapper + config | **keep/extend the forced helper** (`defineAuthorizedHandler`); add a runtime marker and a plugin-level export assertion | makes invariant 1 structural; today an unwrapped route is only caught by a patch-time text rule |
| Route metadata fields | **infer** with a bounded static subset (literal, same-file const, 1-hop project import); no annotation | keeps ordinary TS DX; unknown is explicit |
| Config roles/permissions | **keep `defineConfig`**; parse the literal and resolve defaults with the same `facilisConfigSchema` from core | one validation implementation, no duplicated defaults |
| Tables/columns/RLS | **infer structure**; optionally add a `scopedTable`-style helper; exact values from runtime or drizzle snapshot | re-deriving Drizzle SQL semantics is a mini-compiler; helper/executed artifact is cheaper and safer |
| i18n | **keep `t()`**; infer literals | already the convention; catalogs are static files |
| Blocks | read package manifests; require a manifest producer | rule 7 currently has no data |
| Migrations | read SQL files | no AST needed |
| Imports/aliases | infer from AST + project metadata | replaces the regex |
| Zod request/response schemas | runtime where a document needs them; **do not add a Zod DSL** | Zod is already the DSL; executing it to JSON Schema is the standard path |

If we ever want annotations, restrict them to a line-scoped exception directive with a
mandatory reason, surfaced as a warning in every consumer, and never allow one for
`permission`, `dbTables`, `dbColumns`, `route-security` or RLS. Generated `.d.ts` unions
(`Permission`, `I18nKey`) are useful for DX but must never be security truth.

### 6.3 The static subset we should publish

```
StaticValue := string | number | boolean | null
             | template literal without interpolation
             | array<StaticValue>
             | object<StaticValue>                    // no spread, no computed keys
             | const reference in the same module
             | imported const from a project module   // depth-limited, alias-aware
```

Everything else becomes `unresolved`. The contract must be documented (SPEC §6.9/§7.3) and
enforced by lint/CI. This is the middle ground between "only literals" (too restrictive for
real code) and "a JS evaluator" (a compiler we should not build).

### 6.4 Tri-state metadata

Add the unknown channel everywhere it is missing:

- `RouteMeta.dbTables?: readonly string[]` + `unresolved: MetadataField[]` (or
  `dbTablesKnown: boolean`), so a consumer can distinguish "explicitly no DB" from "unknown";
  today `[]` means both.
- The same for `dbColumns` and RLS presence. Security-sensitive consumers (AI rules, the
  "used by" cross-check, release breaking) must treat unknown as "cannot verify", not "false".
- Pin the `dbColumns` naming domain (recommended: Drizzle property keys, matching the template
  and `PATTERNS.md`) and convert to SQL names where SQL is compared, or store both.

### 6.5 Gate, not just convention

- A Vite plugin check (or lint rule) fails when a route file's default export is not
  statically the wrapper, or when a security field is not in the static subset.
- The AI validator runs the same analysis (browser parser or Monaco's diagnostic + AST facts)
  and fails closed when a fact is unknown.
- In dev, the analyzer vs runtime oracle comparison reports divergence instead of hiding it.
  The oracle is not optional: the analyzer will be wrong sometimes, and executed code is the
  only thing that says when.

## 7. Risks and open questions

**Risks**

1. **Resolver scope creep.** Import resolution, aliases, re-exports, `as const` maps and
   conditional expressions are a slippery slope toward a compiler. Bound it explicitly
   (depth, value-only, no calls except a tiny known set) and fail closed.
2. **Divergence from runtime semantics.** Zod defaults, Drizzle behaviour, config validation
   and policy rendering must not be re-implemented ad hoc. Share pure code where possible
   (config schema, policy model), use executed output or drizzle snapshots for exact values,
   and compare in CI.
3. **Security regression by omission.** The biggest risk: "unknown" silently becoming
   "public/empty". Fix the tri-state before moving any security consumer.
4. **Static analysis is UX, not a security authority.** The VFS is user-writable and the
   analyzer never executes code; the VM-side AST pass and the runtime wrapper remain canonical
   for OpenAPI and the invariants. Do not let a browser-computed fact authorize anything.
5. **Browser integration is empirical, not decorative.** Three proven requirements: one pinned
   emnapi pair (otherwise `setLastError is not a function`), `worker.format: "es"` (otherwise
   `INVALID_TLA_FORMAT`), and a ready-handshake (messages before TLA settlement are dropped).
   Lazy-load the worker; verify the production CSP; keep the parser out of the initial bundle.
6. **Memory.** The wasm binding reserves 250 MiB of linear memory per instance (main and worker
   each), on top of the kernel's own footprint. Measure it against the WebContainer per-tab
   limits before shipping.
7. **WebContainer path is unproven.** oxc-parser's VM support is a runtime `pnpm i` fallback
   plus `node:wasi`, neither verified. Keep rolldown/utils as the VM adapter; do not add
   oxc-parser to generated projects until a spike proves it. The normalized AST contract is
   what keeps this reversible.
8. **Version drift.** The VM is oxc 0.155, the browser candidate 0.156/0.157. The type
   definitions are byte-identical today, but this is a weekly release train: bump rolldown and
   oxc-parser together, and normalize at the `AstNode` boundary rather than relying on types.
9. **Browser traversal surface.** The wasm entry does not export `Visitor`; walking must use
   `visitorKeys` / the generated walker or a small home-grown walker. Budget that code.
10. **Caching and invalidation.** VFS changes, git refs, patch overlays and worker restarts all
    need content-hash invalidation. Do not reuse the current revision hash blindly; it excludes
    migrations and client files.
11. **300-line limit and package boundaries.** A new package with parser adapters, facts and
    rules will need several modules; plan the split from day one.

**Open questions for the decision**

1. Is the target "the IDE works with the dev server down" (yes/no)? That is the main reason to
   put the analyzer in the browser.
2. Does `/__facilis/manifest` stay the public dev contract, with the static sections rebuilt
   from the analyzer, or do we add a separate `/__facilis/analysis`?
3. What is the resolver budget: same-file consts only, or one-hop project imports? (Recommend
   one hop, value-only.)
4. Do we adopt `scopedTable` (a schema helper), or keep parsing `pgTable` call chains?
5. Do we use drizzle-kit's `meta/*_snapshot.json` as the exact-schema oracle, or keep the
   executed `getTableConfig` output? (Snapshot has type/notNull/PK/FK/policies/isRLSEnabled;
   it is only as fresh as the last `db:generate`.)
6. Which browsers must the Studio support? Wasm is broadly available; TLA and CSP need
   verification in the target matrix.
7. Should the analyzer gate merges (CI) or only warn? A gate makes the conventions real; it
   also demands a complete static subset.
8. Is a Node build/dev-time evaluation step acceptable? It already effectively runs at boot;
   the answer decides whether exact Drizzle/config values are **build-time facts** or only
   **runtime facts**. Pure AST everywhere means accepting the static subset instead.

## 8. Proposed spike (not started)

Do this before committing to the package. Exit criteria, not implementation:

**Spike A — browser build (the main unknown).** Add oxc-parser (0.156 preferred; 0.157 with
the identical types accepted) plus the wasi binding to the IDE; pin a single
`@emnapi/core`/`@emnapi/runtime`; set `worker.format: "es"`; add the ready-handshake; parse
~200 real route/schema files in a worker. Prove: build succeeds with the wasm asset; no TLA /
optimizer surprise; cold/warm timings; heap and the 250 MiB reservation; production CSP; no
initial-bundle regression; COOP/COEP intact. Compare the deferred `instantiate` entry with the
root browser entry.

**Spike B — parity and inventory.** Static facts (routes, config, schema declarations, i18n,
imports) vs the runtime manifest/OpenAPI/schema payload on `examples/todo-app`. Report every
difference, including the two known classes (unresolved `dbTables`, camelCase vs SQL
`dbColumns`). Prove the route inventory matches Nitro's own scanner for `server/routes` **and**
`server/api`, including method-less, env-suffixed and unsupported-method files. Cross-check 20
real files parsed by rolldown/oxc 0.155 (VM) and oxc-parser (browser) after normalization.

**Spike C — WebContainer (gated).** In a real generated project, try installing oxc-parser and
determine what actually loads (native → WASI → `webcontainer-fallback.cjs`), whether
`node:wasi` works, and what it costs in install time, bundle and memory. If it fails, keep
`rolldown/utils` in the VM permanently — the normalized analyzer does not depend on the
parser. Also verify that rolldown 1.2.15's `parseSync` reads TS directly, so the current
`transformSync` step can be removed.

**Spike D — gate.** Prove that the export assertion catches an unwrapped/default-export
indirection route and that the AI validator's rule 2 cannot be satisfied by a string.
(Cheap; can be unit-level.)

Exit: one divergence report, zero unexplained differences for the fields the panels need, a
measured browser/worker cost, and a yes/no on "replace the static endpoint payloads".

Rough sizing: the parser is not the cost — the spike is ~1–2 weeks, the first useful analyzer
(routes + config + declared schema + parity tests) another ~3–5 weeks, and the panel/AI
migrations are normal feature work on top. The costs that can blow up are the resolver and the
parity test matrix, not oxc.

## Appendix A — Probe evidence

- Native: 600 parses of three real files in 8 ms; WASI: 813 files / 2.6 MB in 327 ms; cold
  binding load 32 ms. `oxc-parser@0.157.0`, Node 24.22.1.
- WASI on route-like files: 201 files / 887 KB in 109.8 ms median (0.546 ms/file, 7.9 MB/s);
  rolldown/utils native 0.088 ms/file (49.2 MB/s); @babel/parser 0.259 ms/file (16.6 MB/s).
- Real browser: Vite 8.3.5 build (main 254 KB / 61 KB gzip, worker 255 KB, wasm 1.53 MB /
  513 KB gzip); Chromium cold 49–54 ms, worker first parse 1.1 ms; Vite dev mode works too.
- Browser failures reproduced: mixed emnapi (`this.bridge.setLastError is not a function`) until
  one alpha.6/beta.2/beta.3 pair is pinned; iife worker `INVALID_TLA_FORMAT` until
  `worker.format: "es"`; messages dropped before the TLA worker posts ready.
- Memory: the wasm loader allocates `WebAssembly.Memory({ initial: 4000, maximum: 65536 })`
  = 250 MiB initial per instance.
- AST shape: `export default defineAuthorizedHandler({...})` → `ExportDefaultDeclaration` >
  `CallExpression`; config properties and `Literal`/`ArrayExpression` values are directly
  readable; comments available in `result.comments`; syntax errors return `errors[]` plus a
  partial program. `@oxc-project/types` 0.155.0 and 0.157.0 `types.d.ts` are byte-identical.
- Browser entry: `src-js/wasm.js` → `@oxc-parser/binding-wasm32-wasip1` (not in
  optionalDependencies; add it explicitly); loader fetches
  `new URL("./parser.wasm32-wasip1.wasm", import.meta.url)` at top level; `workerd` subpath
  offers manual `instantiate`.
- WebContainer: `src-js/webcontainer-fallback.cjs` and upstream PR #10049 ("auto download wasm
  binding on webcontainer"); the VM currently runs oxc 0.155 via rolldown 1.2.15.
- Repo precedent: `@rolldown/binding-wasm32-wasi` + `@emnapi/*` overrides in
  `ide/src/facilis/project-files.ts`; `@facilis/ai/node` already parses TS directly with
  rolldown's `parseSync`.
- AI text-rule bypass: re-ran the current `maskSource`/matcher logic on a file containing only
  string literals + a raw exported handler; rules 2 and 3 passed as "satisfied".
- `dbColumns` domain: example route uses `todos.dueDate`; migration SQL/snapshot use
  `due_date`; `release-breaking.ts:60-69` compares the SQL form.

## Appendix B — Reading list

- Contract: `docs/SPEC.md` §6, §6.9, §7.3–7.4, §8, §9.3, §11.1–11.4, §13 risk 3.
- Decisions: D-007 (AST pass required), D-083 (live schema), D-084 (validator), D-085 (API
  Flow), D-086 (release preview, no boots), D-090 (template v2).
- Code at analysis time (pre-cutover): `packages/nitro/src/ast/*` (deleted by D-093),
  `packages/ai/src/{scan,config-facts,schema-facts}.ts` (deleted by D-093), plus the still-current
  `packages/nitro/src/{vite,module,facade}.ts`, `packages/nitro/src/runtime/*`,
  `packages/db/src/{snapshot,live-schema,schema-drift}.ts`,
  `ide/src/facilis/{release-schema,release-git,manifest-consumers,manifest-client,data-explorer-client}.ts`.
  The replacement is `packages/analyze/*`; see ast-dsl-contract.md §3.6 and §6.
- Parser: `oxc-parser` npm metadata and README (ESTree / TS-ESTree, visitor, ESM info, options);
  oxc WebContainer commit/PR #10049.
