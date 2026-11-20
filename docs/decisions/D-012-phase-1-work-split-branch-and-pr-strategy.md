# D-012 — Phase 1 work split, branch and PR strategy
**Status:** accepted (2026-10-25)

Phase 1 is split into four disjoint write scopes (one shared task each): `@facilis.dev/core`,
`@facilis.dev/db` + `@facilis.dev/auth`, `@facilis.dev/nitro`, and the `studio/` fork. Module boundaries
and exact public APIs are fixed in `docs/archive/PHASE1-CONTRACTS.md` so the packages can be built in
parallel without import cycles: `db` (leaf) <- `auth` <- `core` <- `nitro`; `core`, `auth`
and `db` never import `nitro`/`vite`/`h3` (they type handlers against a structural event).

Branches: `feat/phase-0-foundation` (PR #1), then `feat/phase-1-core-packages` stacked on it
for packages + the Studio fork + the Phase 1 example app (PR #2). `main` is only updated via
PR.
