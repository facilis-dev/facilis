# D-016 — `.ts` relative imports, workspace examples, excluded fork
**Status:** accepted (2026-10-25)

A Vite config is loaded by **Node's native ESM loader**, which does type stripping but requires
explicit extensions. Because packages export their `src`, the plugin entry graph
(`@facilis.dev/nitro/vite` -> core/db/auth) must be loadable that way. Adopted: relative imports
inside `packages/*/src` carry `.ts`, with `allowImportingTsExtensions` +
`rewriteRelativeImportExtensions` so `tsc` rewrites them to `.js` on emit. `tsconfig.base.json`
also sets `types: ["node"]` (source-exporting packages are typechecked by their consumers, so
the lib/types surface must be uniform).

`examples/*` is a pnpm-workspace glob so the acceptance app is linted, typechecked, tested and
built by the same gates as the packages. `studio/` (the app fork) and `vendor/vivari/` (the
pinned kernel) are explicitly excluded from the workspace, the file-length check, oxlint and
Prettier: they are upstream-owned code with their own toolchain (D-017).
