# vendor/ — the pinned Vivari fork (git submodule)

`vendor/vivari/` is a git submodule of **our fork**,
[`github.com/kele23/vivari`](https://github.com/kele23/vivari) (MIT; upstream
[maitrungduc1410/vivari](https://github.com/maitrungduc1410/vivari)), pinned in `.gitmodules`
(`branch = facilis/main`; the pin itself is the gitlink commit, so a checkout is reproducible).

Why a fork and not the upstream tag (D-030): three upstream defects the IDE depends on are fixed
in `facilis/main` — see [`docs/upstream/`](../docs/upstream/README.md). Pinning the fork means
the product, CI and the smoke harness all execute the code this repo asserts, instead of an
unpatched upstream release. The **worktree is never edited**: every change is a commit on a
branch in the fork, so `git -C vendor/vivari status` stays clean by construction, and each fix
is also its own branch to propose upstream as a PR.

| Piece | Where |
|---|---|
| Our fork | `https://github.com/kele23/vivari` — `master` mirrors upstream, `facilis/main` is what we pin |
| Upstream releases | second remote `upstream` in the same clone: `git -C vendor/vivari fetch upstream --tags` |
| Branch map + workflow | [`docs/upstream/README.md`](../docs/upstream/README.md) |
| Facilis code that uses it | `packages/` (`@facilis/*`) and `ide/` (fork of upstream `packages/studio`) |

## First checkout

```bash
git submodule update --init vendor/vivari   # or: --init --recursive
```

Without it, `vendor/vivari/` is empty and the IDE cannot typecheck or build (its
`@vivari/core` alias points into this tree).

## Update the engine

1. In the fork: rebase the `fix/*` branches onto the new upstream tag, force-push
   `facilis/main`.
2. Here:

```bash
git -C vendor/vivari fetch origin
git -C vendor/vivari checkout <facilis/main sha>   # never a branch head
git add vendor/vivari                              # only the gitlink changes
git commit -m "chore(vendor): bump vivari fork to <sha>"
```

`git status` shows a single changed pointer, not 500 files. Fetching upstream releases is the
fork's job; the pin never moves on its own. A fresh clone has the fork as `origin`, so add the
upstream remote once:

```bash
git -C vendor/vivari remote add upstream https://github.com/maitrungduc1410/vivari.git
git -C vendor/vivari fetch upstream --tags
```

## What the IDE consumes from here

- `packages/core` — aliased from source (`@vivari/core`), brings the kernel workers
- `packages/kernel-host`, `packages/runtime`, `packages/protocol` — runtime shims + vendored binaries
- `packages/{vfs,codec,crypto}` — Rust->Wasm crates; `pkg/` is built with `wasm-pack` (not
  committed upstream, not present in this sandbox)
- `scripts/`, `worker/`, `examples/basic` — available for later phases (asset vendoring, preview worker)

The full upstream tree is present (including upstream docs) because it is a real clone; our
gates ignore `vendor/` entirely.

## Sync checklist after a bump

1. `pnpm ide:smoke` and `TEMPLATE=Facilis pnpm ide:smoke` — the engine is only green when the
   browser path is; plus the `facilis.home` proxy smoke in [`docs/DEV.md`](../docs/DEV.md)
   when the proxy is part of the change.
2. `diff -r vendor/vivari/packages/studio ide` — the only differences must be the IDE patch
   set documented in [`ide/README.md`](../ide/README.md#local-modifications-vs-upstream-the-complete-patch-set).
3. From the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (rebuild the
   Wasm first with `pnpm ide:wasm` if the fork touched a Rust crate).
4. Update the pinned commit here and in `ide/README.md`.

## Verification (2026-10-28, pin `f253381` / `facilis/main` = upstream v1.1.3 + 3 fork commits)

| Check | Result |
|---|---|
| `git submodule status` | clean at `f253381…` (`v1.1.2-6-gf253381`: v1.1.3 + ESM-only targets, OPFS mirror priority, `import.meta.resolve`) |
| `TEMPLATE=Facilis pnpm ide:smoke` | **green**, A12 and the OPFS probe pass as normal checks (the D-028 fix is carried by the pin), no known issues |
| `diff -r vendor/vivari/packages/studio ide` | only the documented IDE patch set |
| Root gates (lint / typecheck / test / build / format / file-length) | pass; `vendor/` excluded, the IDE is a workspace member and included |
| IDE typecheck | `tsc -p tsconfig.app.json --noEmit` with repo TypeScript 7 + `strict`, exit 0 |
| IDE lint | root oxlint/Prettier config, 0 errors |
| IDE dev server | `vite dev` ready ~220 ms; `/` 200, `/src/main.tsx` 200, COOP/COEP present |
| IDE production build | **blocked** on the missing Rust->Wasm `packages/{vfs,codec,crypto}/pkg` in this sandbox |
