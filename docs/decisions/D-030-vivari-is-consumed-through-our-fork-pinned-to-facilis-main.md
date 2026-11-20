# D-030 — Vivari is consumed through our fork, pinned to `facilis/main`
**Status:** accepted (2026-10-28)

The IDE depends on upstream fixes we authored and validated (D-024 ESM-only targets, D-028 OPFS
mirror priority, `import.meta.resolve` returning a path). Keeping them as patch files applied by
hand meant the product, CI and the smoke harness all executed an **unpatched** kernel: every
validation required apply/revert, and the repo's own assertions (A12) stayed a `knownIssue`
against the pinned tag.

**Decision:** `vendor/vivari` is a submodule of **our fork**,
[`github.com/kele23/vivari`](https://github.com/kele23/vivari), pinned to `facilis/main` =
upstream tag `v1.1.4` + the five fix commits and four repository-driven commits (branch map in
the fork's `FORK.md`, inside the submodule). The fork's `master` mirrors upstream and carries
no commits of ours; each fix is also its own branch (`fix/…`) based on upstream `master` and is
proposed upstream as a PR from the fork. `.gitmodules` records the fork URL and
`branch = facilis/main`; the pin is a **commit**, so a checkout is reproducible. The submodule
worktree is never edited, so `git -C vendor/vivari status` is clean by construction.

Workflow (branch map in the fork's `FORK.md`, dev recipe in
[`vendor/README.md`](../vendor/README.md)):

- **bump the engine:** rebase the fix branches onto the new upstream tag in the fork, push
  `facilis/main`, then `git -C vendor/vivari fetch origin && git -C vendor/vivari checkout <sha>`
  and commit the gitlink;
- **upstream release:** `git -C vendor/vivari fetch upstream --tags` (second remote in the same
  clone) and rebase in the fork;
- **fix merged upstream:** drop its commit from `facilis/main`, pin the upstream release that
  carries it, delete the branch;
- **verify a bump:** `pnpm ide:smoke` and `TEMPLATE=Facilis pnpm ide:smoke` (and the
  `facilis.home` proxy smoke in `docs/DEV.md` when the proxy is involved).

**Consequences:** the IDE runs the code this repo asserts — A12 and the OPFS probe pass as
normal checks, no manually applied patches — and the fork is public MIT code linked to upstream,
so CI needs no credentials to clone. What stays invariant: never pin a branch head, never commit
a dirty submodule, and keep `facilis/main` = upstream + exactly the fixes still unmerged
upstream.
