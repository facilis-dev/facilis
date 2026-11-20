# D-019 — The IDE follows the repository toolchain, not upstream's
**Status:** accepted (2026-10-25)

`ide/` is a pnpm-workspace member and is held to AGENTS.md like the framework packages:
**TypeScript strict** (`tsc --strict` and the pinned TypeScript 7: 0 errors on 756 files), the
root **oxlint** config (the upstream per-app `.oxlintrc.json` was removed; its 89 rule errors
were fixed — mostly `eqeqeq`, with the repo rule refined to `"smart"` so `== null` stays
idiomatic), repo **Prettier** (print width 100; the tree was formatted once when the fork
started, a mechanical no-behaviour-change commit), and **vitest** (`src/vv/run-phase.test.ts`,
the pure phase machine). Scripts: `build` = `tsc -b` (passes everywhere), `build:app` = the
full `vite build` which stays blocked on the missing Rust->Wasm `pkg/` outputs.

The 300-line limit is a hard rule for new code. Fourteen inherited files are above it
(`templates.ts` 11.4k lines of template payloads, `controller.ts` 4.3k, ten components,
`vite.config.ts`); they are recorded in `scripts/file-length-baseline.json` and
`scripts/check-file-length.mjs` enforces a **ratchet**: listed files may shrink but not grow,
entries must be deleted when a file drops under the limit, and nothing new can be added.
Splitting them (starting with `controller.ts`) is Phase 2 refactor work.

**Consequences:** `pnpm lint/typecheck/test/build/format:check` cover the IDE (217 files linted,
12 typecheck tasks, 222 tests, 8 build tasks); CI checks out submodules; `ide/README.md` carries
the complete delta vs upstream so an upstream bump stays a mechanical diff.

**Update (2026-10-31):** the Phase 2 split is under way (D-042). `controller.ts` is down from
4,294 to 2,518 lines, its baseline entry is lowered at every step, and the extracted modules are
all under the 300-line limit.
