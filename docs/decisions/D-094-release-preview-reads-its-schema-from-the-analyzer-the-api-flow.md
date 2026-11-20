# D-094 — Release Preview reads its schema from the analyzer; the API Flow consumer scan is named for its manifest scope

**Status:** accepted (2026-11-05)

D-093 left two text scanners in the Studio and recorded why. Re-checked against their actual
inputs, one limit did not hold: the Release Preview compares refs **without booting them**,
which is exactly the analyzer's model (a plain file map plus an injected parser) — the
"historical single file" constraint was a property of the old reader, not of the problem.

**Decision.** `readSnapshotAt`/`readWorkingSnapshot` collect the ref's `db/**` DSL sources and
`facilis.config.ts` (the config can move `tenantColumns`/`ownerColumns`, which decide the
table's `scope`) and hand them to the same warm analyzer worker the project graph and the AI
validator use. The analyzer is a parameter of the release reader, so the Node test injects the
native parser and the Studio passes `analyzeProjectFiles`; `release-schema.ts` is now a pure
mapping plus source selection. The release contract is unchanged: `columns` stay Drizzle
property names and policies stay names. `scoped` becomes the analyzer's config-driven
`TableFact.scope` instead of the old `tenant|owner|user_id` name heuristic (a `userId` column
is session identity, not a scope column). A failed analysis returns a `null` snapshot, so the
panel reports the ref as unreadable rather than diffing a schema whose tables silently
vanished — the same fail-closed rule as the AI validator. Migration SQL and
`release-routes.ts` are untouched: column types/renames still surface only through SQL, and a
route derived at an old ref still knows method+path only.

`api-flow-consumers.ts` is kept on purpose: it matches `/api` URL literals in client sources
against the **live manifest's** operations, answering "what does the running app call?" — it is
not a second reader of the project DSL (URL literals are not DSL facts). It is renamed
`manifest-consumers.ts` (`scanManifestConsumers`, `ManifestConsumers`,
`ManifestConsumerRef`) so the module name states which truth it consumes.

**Follow-up (D-095).** The API Flow was removed and this scan with it: the project graph answers
the page → route question from AST facts without a runtime endpoint.

**Consequences.** The Release Preview now depends on the analyzer worker being available,
exactly like the project graph and the validator. A ref snapshot performs one extra read per
`db/**` source plus `facilis.config.ts`, and its schema facts are no longer spoofable by
comments or strings. No text scanner over project sources remains for DSL facts; the only
source-text scan left is the manifest consumer URL match, which does not interpret the DSL.

**Verification.** IDE 84 files / 651 tests, typecheck, lint (0 errors), `build:app`, file-length
(781 files) and theme checks green; root `lint` (0 errors), `typecheck` (23 tasks), `test`
(21 tasks) and `build` (15 tasks) green. The release reader tests inject the Node parser (no
worker) and the release schema tests assert the analyzer's facts for the template and for
helper/policy expansion. Browser smoke (real Studio + WebContainer): 119 checks pass, including
the Release Preview and API Flow panels (the latter existed at the time); the same four
unrelated chat provider/settings checks remain.
