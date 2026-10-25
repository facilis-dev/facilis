# vendor/ — pinned upstream sources (git submodule)

`vendor/vivari/` is a **real git clone** of [Vivari](https://github.com/maitrungduc1410/vivari)
(MIT), added as a submodule and pinned in `.gitmodules` + the gitlink commit
`1f00a48c6d8009e7f369c1cf36959d61ad262b19` (**tag `v1.1.2`**).

Why a submodule: aligning with upstream must stay a one-command operation, and the upstream
tree must not be copied into our history. It is **upstream code** — never edit it here.
The Facilis code that uses it:

| Path | Role |
|---|---|
| `packages/` | the framework (`@facilis/*`) |
| `ide/` | the IDE app — a fork of upstream `packages/studio` (patch list below) |

## First checkout

```bash
git submodule update --init vendor/vivari   # or: --init --recursive
```

Without it, `vendor/vivari/` is empty and the IDE cannot typecheck or build (its
`@vivari/core` alias points into this tree).

## Align with upstream (the whole point of the submodule)

```bash
# follow upstream master automatically (.gitmodules sets branch = master)
git submodule update --remote vendor/vivari

# or pin a specific tag/commit
git -C vendor/vivari fetch --tags --depth 1
git -C vendor/vivari checkout v1.1.2

git add vendor/vivari   # only the gitlink changes
git commit -m "chore(vendor): bump vivari to <sha>"
```

`git status` shows a single changed pointer, not 500 files.

## What the IDE consumes from here

- `packages/core` — aliased from source (`@vivari/core`), brings the kernel workers
- `packages/kernel-host`, `packages/runtime`, `packages/protocol` — runtime shims + vendored binaries
- `packages/{vfs,codec,crypto}` — Rust->Wasm crates; `pkg/` is built with `wasm-pack` (not
  committed upstream, not present in this sandbox)
- `scripts/`, `worker/`, `examples/basic` — available for later phases (asset vendoring, preview worker)

The full upstream tree is present (including upstream docs) because it is a real clone; our
gates ignore `vendor/` entirely.

## Sync checklist after a bump

1. `diff -r vendor/vivari/packages/studio ide` — the only differences must be the IDE patch
   set documented in [`ide/README.md`](../ide/README.md#local-modifications-vs-upstream-the-complete-patch-set).
2. `cd ide && pnpm install --ignore-workspace && pnpm exec tsc -p tsconfig.app.json --noEmit`.
3. From the repo root: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
4. Update the pinned commit in this file and in `ide/README.md`.

## Verification in this sandbox (2026-10-25, pin `1f00a48` / `v1.1.2`)

| Check | Result |
|---|---|
| `git submodule status` | clean at `1f00a48…` (`v1.1.2`) |
| `diff -r vendor/vivari/packages/studio ide` | only the documented patch set (7 files) |
| Root gates (lint / typecheck / test / build / format / file-length) | pass; `vendor/` excluded, the IDE is a workspace member and included (217 files linted, 12 typecheck tasks, 222 tests, 8 build tasks) |
| IDE typecheck | `tsc -p tsconfig.app.json --noEmit` with repo TypeScript 7 + `strict`, exit 0 (756 files) |
| IDE lint | root oxlint/Prettier config, 0 errors (upstream per-app lint config removed) |
| IDE dev server | `vite dev` ready ~278 ms; `/` 200, `/src/main.tsx` 200, COOP/COEP present |
| IDE production build | **blocked** on the missing Rust->Wasm `packages/{vfs,codec,crypto}/pkg` (`cargo`/`wasm-pack` absent) |
| Browser/WebContainer behaviour | **blocked** — needs Chromium + cross-origin-isolated page + the Rust toolchain |
