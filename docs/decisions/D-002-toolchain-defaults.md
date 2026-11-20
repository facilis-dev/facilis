# D-002 — Toolchain defaults
**Status:** accepted (2026-10-25)

- Node **>= 22.15**, pinned to **26** by `mise.toml` + `mise.lock` (D-182); pnpm workspace (v12) + turbo.
- TypeScript **strict**, ESM only.
- **oxlint** + **Prettier** (print width 100).
- **Vitest** for unit/integration tests.
- **Max 300 lines per source file**, enforced by `scripts/check-file-length.mjs` in CI.
- **Conventional Commits**; branches + PRs into `main`.

**Consequences:** CI runs install → lint → typecheck → test → build; the file-length check
is part of lint, not an optional advisory.
