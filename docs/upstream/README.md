# Upstream Vivari work

Our fork is [`kele23/vivari`](https://github.com/kele23/vivari) (upstream
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari), MIT). `master` mirrors
upstream and carries no commits of ours; **`facilis/main` = upstream tag + the fixes below and
is what `vendor/vivari` pins** (D-030). Each fix is also its own branch, based on upstream
`master`, ready to be proposed upstream as a PR.

| Branch | Fix | Base | Upstream PR |
|---|---|---|---|
| `facilis/main` | integration: the five fixes below plus five Facilis-driven commits, on top of `v1.1.4` (`8e91ade`); pin `3376ba1` | `v1.1.4` | — |
| `fix/runtime-esm-only-targets` | ESM-only package copies vs the require-first resolver (D-024) | `v1.1.4` | [#19](https://github.com/maitrungduc1410/vivari/pull/19) |
| `fix/opfs-mirror-priority` | OPFS mirror: project paths ahead of package-manager caches, manifest written while draining (D-028) | `v1.1.4` | [#21](https://github.com/maitrungduc1410/vivari/pull/21) |
| `fix/import-meta-resolve-url` | `import.meta.resolve` returns a URL, not a path | `v1.1.4` | [#20](https://github.com/maitrungduc1410/vivari/pull/20) |
| `fix/opfs-crosstab-index` | OPFS mirror index: merged per tab under a Web Lock, replaced through a staged copy (D-033) | `v1.1.4` | [#22](https://github.com/maitrungduc1410/vivari/pull/22) |
| `fix/preview-per-tab-kernel` | Preview requests routed to the kernel that owns the frame (`clientId`/`resultingClientId`), per-kernel keep-prefix + tunnel frames (D-033) | `v1.1.4` | [#23](https://github.com/maitrungduc1410/vivari/pull/23) |

The pin was realigned from `v1.1.3` to `v1.1.4` on 2026-10-29: every branch above was rebased
onto the tag, so the fork carries the release's pnpm work (native `realpath` symlinks, the
store-alias remap in `toolchain-shims.js`, the WASI `path_filestat_get` symlink flags) and the
fixes apply to the current upstream tree. One conflict: v1.1.4 added
`npm_config_strict_store_pkg_content_check` to `baseProcEnv`; it is pnpm config like the other
two, so it moved into the pnpm shim with them (see the last paragraph).

Multi-tab (D-033 in the superproject) is what the last two fixes are for: the IDE runs one
project per browser tab, so two kernels share one origin, one preview proxy and one OPFS mirror.

Five of the commits on `facilis/main` are not `fix/*` branches: a template may list
binary assets that the kernel fetches same-origin and writes with the project (D-032, the local
`file:` tarball install), the vendored npm is pinned to 12.2.1, both packers now rebuild a
pack whose stamped version no longer matches the pin instead of silently reusing it, pnpm's
own config (`store-dir`, `package-import-method`, and v1.1.4's `strict-store-pkg-content-check`)
moved from the base process environment into the pnpm shim — npm 12 warned `Unknown env config`
for the first two on every install (D-032 follow-up) — and the OPFS boot restore can be scoped
so a tab replays the project it opens instead of every project on the origin
(`BootOptions.deferRestoreRoots`, D-036).

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
