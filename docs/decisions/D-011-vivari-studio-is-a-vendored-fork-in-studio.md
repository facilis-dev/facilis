# D-011 — Vivari Studio is a vendored fork in `studio/`
**Status:** accepted (2026-10-25); the layout inside it was refined by D-017

`studio/` contains an import of `github.com/maitrungduc1410/vivari` (MIT) pinned to a single
upstream commit, imported as one commit with provenance in `studio/FACILIS.md`. Upstream CI,
marketing site, changesets and the very large planning docs are excluded; upstream
`README.md` is kept as `UPSTREAM-README.md`.

Root gates exclude the vendored tree (`studio` is skipped by
`scripts/check-file-length.mjs`, `.oxlintrc.json` and `.prettierignore`) and it is **not** a
pnpm workspace member, so the framework workspace stays small and CI fast. Facilis changes
go into new modules; upstream files are not rewritten, so re-syncing upstream stays a
path-by-path re-import.

**Consequences:** Studio build/runtime verification is environment-dependent (upstream needs
`bun`, `npm` for vendored assets, and Rust/`wasm-pack` for the VFS/codec/crypto packages -
none present in this sandbox). What can and cannot be verified is recorded in
`studio/FACILIS.md`; Phase 0 browser items (A1-A3, A6, A8-A12) remain open until a
WebContainer-capable browser harness exists.
