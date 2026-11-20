# D-182 — The Node pin is mise's, not `.nvmrc`'s
**Status:** accepted (2026-11-14)

**Context.** D-002 pinned the runtime with `.nvmrc` = 22. The mise config added in #25
(`mise.toml`, `node = "26"`) introduced a second, contradicting pin: mise installed 26 while
`nvm use` installed 22 in the same checkout, CI hand-wrote 22 in both workflows, and no lockfile
existed, so `mise install` resolved whatever 26.x was newest that day.

**Decision.** `mise.toml` is the single pin, made exact by the committed `mise.lock`
(`node = "26"` → 26.13.1 when written). `.nvmrc` is deleted. Both CI workflows install the same
major (`node-version: 26`), because `actions/setup-node` cannot read `mise.toml`: a runtime bump
edits `mise.toml`, runs `mise lock`, and moves both workflows in the same PR.

**Consequences.** `engines.node >= 22.15.0` stays the floor a consumer of the published packages
needs; 26 is the development and CI runtime, tested as such. Verified on 26.13.1:
`pnpm install --frozen-lockfile`, `pnpm lint`, `turbo run typecheck --force` (21 tasks),
`turbo run test --force` (13 packages, 2,619 tests) and `turbo run build --force` (13 tasks) all
pass. Switching CI to `jdx/mise-action` would make the workflow read `mise.toml` directly and
remove the last duplicated version string; it is a follow-up, not part of this decision.
