# D-093 — Nitro and the AI validator consume the analyzer; the WebContainer path keeps rolldown as its parser

**Status:** accepted (2026-11-04)

D-092 introduced `@facilis.dev/analyze` and committed to deleting the duplicated text scanners
once parity tests passed. The cutover has one hard environment constraint: the Nitro Vite
plugin runs inside the generated project's `vite.config.ts` under the Studio's WebContainer,
where the config is loaded with `--configLoader native` and only the bundler's own oxc
(`rolldown/utils`, already a template dependency) is proven to load. `@facilis.dev/analyze/node`
imports `oxc-parser`, whose VM path (runtime package download + `node:wasi`) is unverified;
shipping it in the generated project would put the dev server behind an unproven dependency.

**Decision.** The analyzer's main entry is parser-injected and dependency-free; adapters stay
on explicit subpaths. The Nitro plugin injects `parseSync` from `rolldown/utils` through a
small `Parser` adapter and loads the project map from the new `@facilis.dev/analyze/fs` subpath
(node:fs only, no parser). The IDE keeps its browser wasm parser in the worker. The AI
validator's pure `validatePatch` now consumes the analyzer's **effective (post-patch)
`Analysis`** plus the pre-patch one for inverse edits; the IDE builds both from one cached VFS
snapshot and the patch overlay on the single warm worker, and fails the round closed with a
`project-analysis` error if the analyzer is unavailable (it never falls back to text scanning).
`@facilis.dev/ai` imports the analyzer types only, so its main entry stays browser-safe; the Node
helper lives in `@facilis.dev/ai/node`. `@facilis.dev/analyze` becomes part of the generated project's
vendored tarball set (its `oxc-parser` dependency is an optional peer, so the VM never installs
it) and `@facilis.dev/analyze/fs` ships compiled.

**Deleted (replaced by the analyzer):** `packages/nitro/src/ast/**` (scanner, extractor,
static eval, route-path + tests), `packages/ai/src/{scan,config-facts,schema-facts}.ts`, and the
Nitro `rolldown` AST scanner tests. The two remaining scanners are intentionally not deleted
yet: `ide/src/facilis/release-schema.ts` reads a **historical single file** at an arbitrary git
ref (the analyzer needs a full module graph, which the git-tree workbook does not provide) and
`ide/src/facilis/api-flow-consumers.ts` is a live-manifest consumer view, not a source-of-truth
reader. Both are tracked as follow-ups; D-092's "one fact model" rule applies to project
introspection, which they no longer duplicate (release preview diffs refs; API Flow renders the
running manifest).

**Consequences.** Nitro's manifest/OpenAPI facts now change when any project source changes
(config and imported consts are analyzer input), not only when a route file changes. The
manifest lists wrapper-less routes with `security: "unknown"` instead of omitting them, and the
`defineRouteMeta` fallback is gone. Permission metadata is normalized to an array. Methods
outside core's five are omitted with a warning (the manifest `HttpMethod` contract is
unchanged). The AI rules are no longer spoofable by comments/strings: wrapper, body-read,
`dbTables` and permissions are AST facts; `dbColumns` use Drizzle property names end-to-end;
rules 10/14/15 ignore framework re-exported tables.

**Verification.** `@facilis.dev/analyze` 66 tests; `@facilis.dev/ai` 61 tests (same rule scenarios plus
new fact seams); `@facilis.dev/nitro` 120 tests including the injected-parser `as const` proof and
the "any source edit invalidates" test; IDE 84 files / 649 tests. Root `lint` (0 errors),
`typecheck` (23 tasks), `test` (21 tasks), `build` (15 tasks), file-length and theme checks green.
Browser smoke (real Studio + WebContainer): project-graph checks pass; the four unrelated chat
provider/settings checks remain. `@facilis.dev/nitro` grep confirms no `@facilis.dev/analyze/node`
import in source or dist.

**Follow-up (2026-11-05, D-094).** The two scanners named above are gone: the Release Preview
reads its schema through the analyzer and the consumer scan is `manifest-consumers.ts`.
