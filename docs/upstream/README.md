# Upstream Vivari work

Our fork is [`kele23/vivari`](https://github.com/kele23/vivari) (upstream
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari), MIT). `master` mirrors
upstream and carries no commits of ours; **`facilis/main` = upstream tag + the fixes below and
is what `vendor/vivari` pins** (D-030). Each fix is also its own branch, based on upstream
`master`, ready to be proposed upstream as a PR.

| Branch | Fix | Base | Upstream PR |
|---|---|---|---|
| `facilis/main` | integration: the three fixes below plus three Facilis-driven commits, on top of `v1.1.3` (`cec9e81`); pin `02740ca` | `v1.1.3` | — |
| `fix/runtime-esm-only-targets` | ESM-only package copies vs the require-first resolver (D-024) | `v1.1.3` | not opened |
| `fix/opfs-mirror-priority` | OPFS mirror: project paths ahead of package-manager caches, manifest written while draining (D-028) | `v1.1.3` | not opened |
| `fix/import-meta-resolve-url` | `import.meta.resolve` returns a URL, not a path | `v1.1.3` | not opened |

The three Facilis-driven commits on `facilis/main` are not `fix/*` branches: a template may list
binary assets that the kernel fetches same-origin and writes with the project (D-032, the local
`file:` tarball install), the vendored npm is pinned to 12.2.1, and both packers now rebuild a
pack whose stamped version no longer matches the pin instead of silently reusing it.

The same commits, `git am`-able and with their PR bodies, are kept next to this file
(`vivari-*.patch`, `vivari-*-pr.md`) so they can be replayed without the fork. Evidence and the
negative results are in [`vivari-findings-2026-10-28.md`](./vivari-findings-2026-10-28.md).

## Workflow

- **New fix:** branch from the fork's `master` (after `git -C vendor/vivari fetch upstream
  --tags`), commit with a changeset, run upstream's offline tiers if it is runtime-side, open
  the PR from the fork to `maitrungduc1410/vivari:master`, then merge the commit into
  `facilis/main` and bump the submodule pin here (D-030).
- **Upstream release:** fetch the new tag in the fork (a fresh clone adds the upstream remote
  once: `git -C vendor/vivari remote add upstream https://github.com/maitrungduc1410/vivari.git`),
  rebase every `fix/*` onto it, force-push the branches and `facilis/main`, then
  `TEMPLATE=Facilis pnpm ide:smoke` here and bump the pin.
- **Fix merged upstream:** drop its commit from `facilis/main` (rebase), point the pin at the
  release that carries it, delete the branch. The `.patch` artifacts stay as a record.
- **Never** edit the submodule worktree, and never pin a branch head — always the commit.

## Status notes

- The `facilis.home` install failures are **not** upstream work: nginx retires an HTTP/2
  connection after 1000 requests and middleware-mode dev crossed that boundary several times per
  run (D-029). The IDE now avoids it by serving the dev app in Vite's full-bundle mode (D-031);
  the proxy fix is still worth applying but is no longer on the critical path.
- `Kernel: throttle concurrent Process Worker boots` was validated and then **dropped** — it
  reduced concurrency but not request volume, so it only shifted the probability. D-031 removes
  the volume itself (a worker no longer loads a 190-request graph in dev). The branch is gone; do
  not re-add it.
